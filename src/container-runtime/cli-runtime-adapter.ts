import { type CommandRunner, nodeCommandRunner } from "@/shell/command-runner";
import type { ContainerDetails, RuntimeAdapter } from "./runtime-adapter";
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
  const run = (command: string, args: string[]) =>
      shell.run(command, args, { timeoutMs: commandTimeoutMs }),
    installedVersion = async (
      name: RuntimeName
    ): Promise<string | undefined> => {
      try {
        const { stdout } = await run(name, ["--version"]);
        return VERSION_PATTERN.exec(stdout)?.[0] ?? stdout.trim();
      } catch (error) {
        if (isMissingBinary(error)) {
          return undefined;
        }
        throw error;
      }
    },
    /** `info` talks to the daemon or VM, so it only succeeds when the runtime is running. */
    isRunning = async (name: RuntimeName): Promise<boolean> => {
      try {
        await run(name, ["info", "--format", "{{.ServerVersion}}"]);
        return true;
      } catch {
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
    buildImage: async (name, { context, dockerfile, labels, tag }) => {
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
        { input: dockerfile, timeoutMs: BUILD_TIMEOUT_MS }
      );
    },
    detect: async (name): Promise<RuntimeStatus> => {
      const version = await installedVersion(name);
      if (version === undefined) {
        return { installed: false, name };
      }
      return { installed: true, name, running: await isRunning(name), version };
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
    isListening: async (name, containerId, port) => {
      try {
        await run(name, [
          "exec",
          containerId,
          "sh",
          "-c",
          `grep -qi ':${HEX_PORT(port)} ' /proc/net/tcp /proc/net/tcp6`,
        ]);
        return true;
      } catch {
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
    runContainer: async (name, { environment, image, labels, port }) => {
      const { stdout } = await shell.run(
          name,
          [
            "run",
            "-d",
            ...HARDENING,
            "-p",
            `127.0.0.1::${port}`,
            ...Object.entries(labels).flatMap(([key, value]) => [
              "-l",
              `${key}=${value}`,
            ]),
            // Names only: values travel through the child environment, never the argument list.
            ...Object.keys(environment).flatMap((key) => ["-e", key]),
            image,
          ],
          { environment, timeoutMs: commandTimeoutMs }
        ),
        containerId = stdout.trim(),
        published = await run(name, ["port", containerId, `${port}/tcp`]),
        hostPort = Number(/:(\d+)\s*$/mu.exec(published.stdout)?.[1]);
      if (Number.isNaN(hostPort)) {
        throw new TypeError(
          `Could not find the host port for container ${containerId}: ${published.stdout.trim()}`
        );
      }
      return { containerId, hostPort };
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
      if (containerIds.length === 0) {
        return;
      }
      await shell.run(name, ["start", ...containerIds], {
        timeoutMs: LIFECYCLE_TIMEOUT_MS,
      });
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
