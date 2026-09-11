import { ComparisonStartError } from "@/comparison/comparison-start-error";
import { type CommandRunner, nodeCommandRunner } from "@/shell/command-runner";
import type {
  ContainerDetails,
  RunRequest,
  RuntimeAdapter,
} from "./runtime-adapter";
import { DEVELOPMENT_TRANSPORT } from "@/instance/development-launcher";
import { randomUUID } from "node:crypto";
import type { RuntimeName, RuntimeStatus } from "./runtime-status";
import { startPlan } from "./start-command";

export type { CommandRunner };

export interface CliAdapterOptions {
  /** Upper bound per CLI call so a wedged daemon cannot hang the page. */
  commandTimeoutMs?: number;
  platform: NodeJS.Platform;
  /** Upper bound for the start command; booting a VM (`podman machine start`) takes well over the per-call default. */
  startTimeoutMs?: number;
}

/** The shape shared by `docker inspect` and `podman inspect`. */
interface InspectResponse {
  Config?: { Labels?: Record<string, string> | null };
  Created?: string;
  Id: string;
  NetworkSettings?: {
    Ports?: Record<string, { HostPort: string }[] | null> | null;
  };
  State?: { Status?: string };
}

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000,
  DEFAULT_START_TIMEOUT_MS = 120_000,
  /** Stopping or removing waits for the container's own shutdown grace period. */
  LIFECYCLE_TIMEOUT_MS = 60_000,
  BUILD_TIMEOUT_MS = 30 * 60 * 1000,
  /** Resource caps for one Instance. */
  HARDENING = [
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    "4g",
    "--cpus",
    "2",
    "--pids-limit",
    "1024",
    "--tmpfs",
    "/tmp",
  ],
  HEX_PORT = (port: number): string =>
    port.toString(16).toUpperCase().padStart(4, "0"),
  VERSION_PATTERN = /\d+\.\d+\.\d+/u,
  /** Shortest useful line from a failed command: stderr when present, else the error message. */
  failureReason = (error: unknown): string => {
    if (typeof error === "object" && error !== null) {
      const stderr = "stderr" in error ? String(error.stderr).trim() : "";
      if (stderr !== "") {
        return stderr.split("\n").at(-1) ?? stderr;
      }
      if (error instanceof Error) {
        return error.message;
      }
    }
    return String(error);
  },
  parseInspect = (stdout: string): ContainerDetails[] =>
    (JSON.parse(stdout) as InspectResponse[]).map((entry) => {
      const published = Object.values(entry.NetworkSettings?.Ports ?? {})
          .flat()
          .find((binding) => binding !== null && binding !== undefined),
        hostPort = Number(published?.HostPort);
      return {
        containerId: entry.Id,
        createdAt: entry.Created ?? "",
        hostPort:
          Number.isNaN(hostPort) || hostPort === 0 ? undefined : hostPort,
        labels: entry.Config?.Labels ?? {},
        state: entry.State?.Status === "running" ? "running" : "stopped",
      };
    }),
  isMissingBinary = (error: unknown): boolean =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT";

export const createCliRuntimeAdapter = (
  shell: CommandRunner,
  {
    commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    platform,
    startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
  }: CliAdapterOptions
): RuntimeAdapter => {
  const snapshots = new Map<string, RunRequest>(),
    deliver = async (
      name: RuntimeName,
      containerId: string,
      request: RunRequest,
      restarting = false
    ) => {
      try {
        const command = [
            "exec",
            "-i",
            containerId,
            "node",
            "-e",
            DEVELOPMENT_TRANSPORT,
          ],
          canary = `sauce-probe-${randomUUID()}`,
          probe = await shell.run(name, command, {
            input: JSON.stringify({ canary, probe: true }),
            signal: request.signal,
            timeoutMs: commandTimeoutMs,
          }),
          inspected = await run(name, ["inspect", containerId], request.signal);
        if (probe.stdout !== "ready" || inspected.stdout.includes(canary)) {
          throw new Error();
        }
        const environment = { ...request.environment };
        if (restarting) {
          delete environment.NODE_AUTH_TOKEN;
        }
        let pending = "";
        const report = (chunk: string) => {
            pending += chunk;
            if (pending.length > 1024) {
              pending = "";
              return;
            }
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            for (const line of lines) {
              if (line === "installing") {
                request.onProgress?.("install");
              }
              if (line === "starting") {
                request.onProgress?.("start");
              }
            }
          },
          response = await shell.run(name, command, {
            input: JSON.stringify({
              environment,
              port: request.port,
              ...request.development,
              ...(restarting ? { installCommand: "" } : {}),
            }),
            onStdout: report,
            signal: request.signal,
            timeoutMs: BUILD_TIMEOUT_MS,
          }),
          result = response.stdout.split("\n").at(-1);
        if (result === "installation-failed") {
          throw new Error("installation-failed");
        }
        if (result !== "started") {
          throw new Error();
        }
      } catch (error) {
        request.signal?.throwIfAborted();
        // No child output, payload or original error may escape this boundary.
        // oxlint-disable-next-line preserve-caught-error -- Causes can contain credentials in runtime output.
        throw new ComparisonStartError(
          error instanceof Error && error.message === "installation-failed"
            ? "Dependency installation failed. Open Compare → Configure repository and check the Dependency installation command. Check NODE_AUTH_TOKEN in Environment Files on Compare or Environment variables in Repository Config. Raw logs are suppressed to protect credentials."
            : `Could not securely start the development server with ${name}. Check Container Runtime in Settings for interactive exec support, and Development server command in Compare → Configure repository. Raw logs are suppressed to protect credentials.`
        );
      }
    },
    run = (command: string, args: string[], signal?: AbortSignal) =>
      shell.run(command, args, {
        timeoutMs: commandTimeoutMs,
        ...(signal ? { signal } : {}),
      }),
    installedVersion = async (
      name: RuntimeName,
      signal?: AbortSignal
    ): Promise<string | undefined> => {
      try {
        const { stdout } = await run(name, ["--version"], signal);
        return VERSION_PATTERN.exec(stdout)?.[0] ?? stdout.trim();
      } catch (error) {
        if (isMissingBinary(error)) {
          return undefined;
        }
        throw error;
      }
    },
    /**
     * `info` talks to the daemon or VM, so it only succeeds when the runtime is running.
     * No `--format`: docker's `.ServerVersion` field does not exist in podman's info, and a
     * template that fails to evaluate exits non-zero even when the machine is up.
     */
    isRunning = async (
      name: RuntimeName,
      signal?: AbortSignal
    ): Promise<boolean> => {
      try {
        await run(name, ["info"], signal);
        return true;
      } catch {
        signal?.throwIfAborted();
        return false;
      }
    },
    /** Active docker context, e.g. `colima` or `desktop-linux`; empty when unknown. */
    dockerContext = async (): Promise<string> => {
      try {
        const { stdout } = await run("docker", ["context", "show"]);
        return stdout.trim();
      } catch {
        return "";
      }
    };

  return {
    buildImage: async (name, { context, dockerfile, labels, tag, signal }) => {
      await shell.run(
        name,
        [
          "build",
          "-t",
          tag,
          ...Object.entries(labels).flatMap(([key, value]) => [
            "--label",
            `${key}=${value}`,
          ]),
          ...(dockerfile === undefined ? [] : ["-f", "-"]),
          context,
        ],
        { input: dockerfile, signal, timeoutMs: BUILD_TIMEOUT_MS }
      );
    },
    detect: async (name, signal): Promise<RuntimeStatus> => {
      const version = await installedVersion(name, signal);
      if (version === undefined) {
        return { installed: false, name };
      }
      return {
        installed: true,
        name,
        running: await isRunning(name, signal),
        version,
      };
    },
    inspectContainers: async (name, containerIds) => {
      if (containerIds.length === 0) {
        return [];
      }
      try {
        const { stdout } = await run(name, ["inspect", ...containerIds]);
        return parseInspect(stdout);
      } catch (error) {
        // Inspect exits non-zero when any id is gone but still prints the rest.
        const stdout =
          typeof error === "object" && error !== null && "stdout" in error
            ? String(error.stdout)
            : "";
        return stdout.trim().startsWith("[") ? parseInspect(stdout) : [];
      }
    },
    isListening: async (name, containerId, port, signal) => {
      try {
        await run(
          name,
          [
            "exec",
            containerId,
            "sh",
            "-c",
            `grep -qi ':${HEX_PORT(port)} ' /proc/net/tcp /proc/net/tcp6`,
          ],
          signal
        );
        return true;
      } catch {
        signal?.throwIfAborted();
        return false;
      }
    },
    listContainers: async (name, label) => {
      const { stdout } = await run(name, [
        "ps",
        "-aq",
        "--no-trunc",
        "--filter",
        `label=${label}`,
      ]);
      return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
    },
    removeContainers: async (name, containerIds) => {
      for (const id of containerIds) {
        snapshots.delete(`${name}:${id}`);
      }
      if (containerIds.length === 0) {
        return;
      }
      await shell.run(name, ["rm", "-f", ...containerIds], {
        timeoutMs: LIFECYCLE_TIMEOUT_MS,
      });
    },
    removeImages: async (name, label) => {
      await run(name, ["image", "prune", "-af", "--filter", `label=${label}`]);
    },
    runContainer: async (name, request) => {
      const { environment, image, labels, port, development } = request;
      if (!development && Object.keys(environment).length > 0) {
        throw new Error(
          "Credential delivery requires the development launcher."
        );
      }
      const { stdout } = await shell.run(
          name,
          [
            "run",
            "-d",
            "--log-driver",
            "none",
            ...HARDENING,
            "-p",
            `127.0.0.1::${port}`,
            ...Object.entries(labels).flatMap(([key, value]) => [
              "-l",
              `${key}=${value}`,
            ]),
            image,
          ],
          { signal: request.signal, timeoutMs: commandTimeoutMs }
        ),
        containerId = stdout.trim();
      try {
        request.signal?.throwIfAborted();
        const published = await run(
            name,
            ["port", containerId, `${port}/tcp`],
            request.signal
          ),
          hostPort = Number(/:(\d+)\s*$/mu.exec(published.stdout)?.[1]);
        if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65_535) {
          throw new Error("Could not find the Instance host port.");
        }
        if (development) {
          await deliver(name, containerId, request);
          snapshots.set(`${name}:${containerId}`, {
            ...request,
            environment: { ...environment },
            onFailure: undefined,
            onProgress: undefined,
            signal: undefined,
          });
        }
        return { containerId, hostPort };
      } catch (error) {
        request.onFailure?.(error);
        await shell
          .run(name, ["rm", "-f", containerId], {
            timeoutMs: LIFECYCLE_TIMEOUT_MS,
          })
          .catch(() => {});
        throw error;
      }
    },
    start: async (name) => {
      const { command, hint } = startPlan(name, {
        dockerContext: await dockerContext(),
        platform,
      });
      if (!command) {
        throw new Error(
          `${name} cannot be started from here. ${hint} and try again.`
        );
      }
      const [executable, args] = command;
      try {
        await shell.run(executable, args, { timeoutMs: startTimeoutMs });
      } catch (error) {
        throw new Error(
          `Could not start ${name} with \`${[executable, ...args].join(" ")}\`. ${hint} and try again. (${failureReason(error)})`,
          { cause: error }
        );
      }
    },
    startContainers: async (name, containerIds) => {
      for (const containerId of containerIds) {
        if (!snapshots.has(`${name}:${containerId}`)) {
          throw new Error(
            "This Instance has no in-memory configuration. Run a new Comparison."
          );
        }
      }
      if (containerIds.length === 0) {
        return;
      }
      await shell.run(name, ["start", ...containerIds], {
        timeoutMs: LIFECYCLE_TIMEOUT_MS,
      });
      try {
        await Promise.all(
          containerIds.map((containerId) =>
            deliver(
              name,
              containerId,
              snapshots.get(`${name}:${containerId}`)!,
              true
            )
          )
        );
      } catch (error) {
        await shell
          .run(name, ["stop", ...containerIds], {
            timeoutMs: LIFECYCLE_TIMEOUT_MS,
          })
          .catch(() => {});
        throw error;
      }
    },
    stopContainers: async (name, containerIds) => {
      if (containerIds.length === 0) {
        return;
      }
      await shell.run(name, ["stop", ...containerIds], {
        timeoutMs: LIFECYCLE_TIMEOUT_MS,
      });
    },
  };
};

/** Real Container Runtime adapter: shells out to `docker` / `podman` only. */
export const cliRuntimeAdapter: RuntimeAdapter = createCliRuntimeAdapter(
  nodeCommandRunner,
  { platform: process.platform }
);
