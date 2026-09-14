import { ComparisonStartError } from "@/comparison/comparison-start-error";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  type BuildSecret,
  type HttpProbe,
  type RuntimeAdapter,
  bridgePortFor,
} from "@/container-runtime/runtime-adapter";
import type { RuntimeName } from "@/container-runtime/runtime-status";
import type { RepositoryConfig } from "@/settings/settings-store";
import type { GitHubRequestLog } from "@/github/request-log";
import type { CommandRunner } from "@/shell/command-runner";
import { buildFailureMessage } from "./build-diagnostics";
import { developmentExitMessage } from "./installation-diagnostics";
import { cloneBranch } from "./clone-branch";
import { generateDockerfile } from "./dockerfile";
import { prepareDevelopmentContext } from "./development-context";
import { validateInstanceEnvironment } from "@/repository-config/environment-files";
import {
  APP_LABEL,
  BRANCH_LABEL,
  REPOSITORY_LABEL,
  SESSION_LABEL,
  appLabelValue,
} from "./labels";

export { BRANCH_LABEL, SESSION_LABEL } from "./labels";

export type InstanceStep =
  | "clone"
  | "container"
  | "install"
  | "start"
  | "readiness"
  | "response"
  | "ready";

export interface InstanceRequest {
  signal?: AbortSignal;
  onProgress?: (step: InstanceStep) => void;
  /** Live diagnosis of the current step, shown while the Instance is still starting. */
  onDetail?: (step: InstanceStep, text: string) => void;
  onFailure?: (error: unknown) => void;
  branch: string;
  codeDirectory?: string | undefined;
  config: RepositoryConfig;
  environment: Record<string, string>;
  setupEnvironment?: Record<string, string>;
  environmentFiles?: string[];
  organisation: string;
  readiness: { pollIntervalMs: number; timeoutMs: number };
  repository: string;
  runtime: RuntimeName;
  sessionId: string;
  token: string;
  /** Where the clone goes; one Instance per branch under it. */
  workDirectory: string;
}

/** A locally built and running copy of one branch. */
export interface Instance {
  branch: string;
  clonePath: string;
  containerId: string;
  hostPort: number;
}

/** Sends `GET /` from the host to the published port; the default really connects. */
export type HostProbe = (
  hostPort: number,
  signal?: AbortSignal
) => Promise<HttpProbe>;

export interface InstanceDependencies {
  git: CommandRunner;
  /** Replaced in tests whose published ports are made up. */
  probeHost?: HostProbe;
  /** Where the clone's GitHub transfer is recorded; omitted in tests that never reach GitHub. */
  requestLog?: GitHubRequestLog;
  runtime: RuntimeAdapter;
}

const slug = (text: string): string =>
    text
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, "-")
      .replaceAll(/^-|-$/gu, ""),
  assertRunning = async (
    adapter: RuntimeAdapter,
    name: RuntimeName,
    signal?: AbortSignal
  ): Promise<void> => {
    const status = await adapter.detect(name, signal);
    if (!status.installed) {
      throw new ComparisonStartError(
        `${name} is not installed. Install it and try again.`
      );
    }
    if (!status.running) {
      const cause =
        status.reason === undefined
          ? ""
          : ` (\`${name} info\` failed: ${status.reason})`;
      throw new ComparisonStartError(
        `${name} is not running${cause}. Start it from Settings and try again.`
      );
    }
  },
  /** Where the reviewer can watch the development server's output, which Sauce Control never keeps. */
  RUN_LOCALLY = (startCommand: string, clonePath: string): string =>
    `Its output is not kept, to protect credentials: run \`${startCommand}\` in ${clonePath} to see it.`,
  /** Throws once the development server has exited; the container is stopped by then. */
  assertServerRunning = async (
    adapter: RuntimeAdapter,
    { branch, runtime, signal }: InstanceRequest,
    containerId: string,
    startCommand: string,
    clonePath: string
  ): Promise<void> => {
    const [details] = await adapter.inspectContainers(runtime, [containerId]);
    signal?.throwIfAborted();
    if (details === undefined || details.state === "running") {
      return;
    }
    const record = await adapter.exitRecord(runtime, containerId, signal),
      exit =
        (record === undefined ? undefined : developmentExitMessage(record)) ??
        "The development server exited.";
    throw new ComparisonStartError(
      `${branch}: ${exit} ${RUN_LOCALLY(startCommand, clonePath)}`
    );
  },
  waitUntilListening = async (
    adapter: RuntimeAdapter,
    request: InstanceRequest,
    containerId: string,
    startCommand: string,
    clonePath: string
  ): Promise<void> => {
    const { branch, config, readiness, runtime, signal } = request,
      deadline = Date.now() + readiness.timeoutMs,
      poll = async (): Promise<void> => {
        signal?.throwIfAborted();
        if (
          await adapter.isListening(runtime, containerId, config.port, signal)
        ) {
          return;
        }
        await assertServerRunning(
          adapter,
          request,
          containerId,
          startCommand,
          clonePath
        );
        if (Date.now() >= deadline) {
          throw new ComparisonStartError(
            `${branch} did not listen on port ${config.port} within ${readiness.timeoutMs}ms. Open Compare → Configure repository and check Development server command and Port. Check Environment Files on Compare for required app credentials.`
          );
        }
        await sleep(readiness.pollIntervalMs, undefined, { signal });
        await poll();
      };
    await poll();
  },
  /** One host request may take this long; a development server compiling its first Page needs it. */
  HOST_PROBE_TIMEOUT_MS = 15_000,
  probeHostOverHttp: HostProbe = async (hostPort, signal) => {
    const timeout = AbortSignal.timeout(HOST_PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(`http://127.0.0.1:${hostPort}/`, {
        redirect: "manual",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      await response.body?.cancel();
      return { outcome: "answered", status: response.status };
    } catch {
      signal?.throwIfAborted();
      return { outcome: timeout.aborted ? "timeout" : "refused" };
    }
  },
  describe = (probe: HttpProbe): string =>
    probe.outcome === "answered"
      ? `answered HTTP ${probe.status}`
      : {
          refused: "refused the connection",
          timeout: `accepted the connection but sent nothing for ${HOST_PROBE_TIMEOUT_MS / 1000}s`,
          unavailable: "could not be probed",
        }[probe.outcome],
  /**
   * Names the hop that fails: the application inside the container, or the bridge between
   * the published port and the application.
   */
  diagnose = (
    { branch, config }: InstanceRequest,
    hostPort: number,
    host: HttpProbe,
    inside: HttpProbe
  ): string => {
    const where = `GET / on 127.0.0.1:${hostPort} (host) ${describe(host)}; GET / on port ${config.port} inside the container ${describe(inside)}.`;
    if (inside.outcome === "answered") {
      return `${branch} works inside its container but not through the published port ${bridgePortFor(config.port)}. ${where} The bridge is not relaying; check the Container Runtime's port forwarding (podman machine or Docker Desktop).`;
    }
    if (inside.outcome === "timeout") {
      return `${branch} listens on port ${config.port} but never responds. ${where} The development server hangs while handling its first request: usually a server-side call to a host the Container Runtime VM cannot reach (an internal API, a VPN-only service) or a blocked download during compilation (Google Fonts, a CDN). Check the app's server-side fetches and the Environment Files on Compare.`;
    }
    if (inside.outcome === "refused") {
      return `${branch} has port ${config.port} open but refuses connections on 127.0.0.1 and ::1 inside the container. ${where} The development server may be bound to another address; open Compare → Configure repository and check Development server command and Port.`;
    }
    return `${branch} is not answering HTTP requests. ${where}`;
  },
  /** Polls `GET /` through the published port until it answers, naming the failing hop meanwhile. */
  waitUntilResponding = async (
    adapter: RuntimeAdapter,
    probeHost: HostProbe,
    request: InstanceRequest,
    containerId: string,
    hostPort: number,
    startCommand: string,
    clonePath: string
  ): Promise<void> => {
    const { readiness, runtime, signal } = request,
      deadline = Date.now() + readiness.timeoutMs,
      attempt = async (): Promise<void> => {
        signal?.throwIfAborted();
        const host = await probeHost(hostPort, signal);
        if (host.outcome === "answered") {
          return;
        }
        signal?.throwIfAborted();
        await assertServerRunning(
          adapter,
          request,
          containerId,
          startCommand,
          clonePath
        );
        const inside = await adapter.probeHttp(
            runtime,
            containerId,
            request.config.port,
            signal
          ),
          diagnosis = diagnose(request, hostPort, host, inside);
        if (Date.now() >= deadline) {
          throw new ComparisonStartError(
            `${diagnosis} Gave up after ${readiness.timeoutMs}ms.`
          );
        }
        request.onDetail?.("response", `${diagnosis} Still trying.`);
        await sleep(readiness.pollIntervalMs, undefined, { signal });
        await attempt();
      };
    await attempt();
  },
  /** Clone, build, and start one branch as an Instance; resolves once it answers on its port. */
  /** Registry credentials the Dockerfile's install step mounts; absent variables are simply not mounted. */
  BUILD_SECRET_IDS = ["NODE_AUTH_TOKEN", "NPM_REGISTRY"] as const,
  buildSecrets = (environment: Record<string, string>): BuildSecret[] =>
    BUILD_SECRET_IDS.flatMap((id) => {
      const value = environment[id];
      return value === undefined ? [] : [{ id, value }];
    });

export const runInstance = async (
  {
    git,
    probeHost = probeHostOverHttp,
    requestLog,
    runtime,
  }: InstanceDependencies,
  request: InstanceRequest
): Promise<Instance> => {
  const { branch, config, environment, repository, sessionId } = request,
    clonePath = join(request.workDirectory, slug(branch)),
    tag = `sauce-control/${slug(repository)}-${slug(branch)}:${slug(sessionId)}`,
    ownership = { [APP_LABEL]: appLabelValue(), [SESSION_LABEL]: sessionId };

  request.signal?.throwIfAborted();
  await assertRunning(runtime, request.runtime, request.signal);
  request.signal?.throwIfAborted();
  request.onProgress?.("clone");
  await cloneBranch(
    git,
    {
      branch,
      codeDirectory: request.codeDirectory,
      destination: clonePath,
      organisation: request.organisation,
      repository,
      signal: request.signal,
      token: request.token,
    },
    requestLog
  ).catch(() => {
    request.signal?.throwIfAborted();
    throw new ComparisonStartError(
      "Could not clone the Repository branch. Check the selected branches on Compare, GitHub access in Settings, and the network connection."
    );
  });
  request.signal?.throwIfAborted();
  request.onProgress?.("container");
  validateInstanceEnvironment(environment, config.port);
  const { context, development } = await prepareDevelopmentContext(
      clonePath,
      request
    ),
    // Secrets only join a build whose Dockerfile mounts them; a plain build stays
    // Compatible with runtimes that lack BuildKit.
    registryAuth =
      environment.NODE_AUTH_TOKEN !== undefined &&
      existsSync(join(context, "source", "pnpm-lock.yaml")),
    secrets = registryAuth ? buildSecrets(environment) : [];
  try {
    await runtime.buildImage(request.runtime, {
      context,
      dockerfile: generateDockerfile(undefined, { registryAuth }),
      labels: ownership,
      secrets,
      signal: request.signal,
      tag,
    });
  } catch (error) {
    request.signal?.throwIfAborted();
    // Build output can carry registry URLs or tokens; only fixed messages leave here.
    // oxlint-disable-next-line preserve-caught-error -- Causes can contain credentials in build output.
    throw new ComparisonStartError(buildFailureMessage(error));
  } finally {
    rmSync(context, { force: true, recursive: true });
  }
  const { containerId, hostPort } = await runtime.runContainer(
    request.runtime,
    {
      development,
      environment,
      image: tag,
      labels: {
        ...ownership,
        [BRANCH_LABEL]: branch,
        [REPOSITORY_LABEL]: repository,
      },
      onFailure: request.onFailure,
      onProgress: request.onProgress,
      port: config.port,
      setupEnvironment: request.setupEnvironment,
      signal: request.signal,
    }
  );
  try {
    request.signal?.throwIfAborted();
    request.onProgress?.("readiness");
    await waitUntilListening(
      runtime,
      request,
      containerId,
      development.startCommand,
      clonePath
    );
    request.signal?.throwIfAborted();
    request.onProgress?.("response");
    await waitUntilResponding(
      runtime,
      probeHost,
      request,
      containerId,
      hostPort,
      development.startCommand,
      clonePath
    );
    request.signal?.throwIfAborted();
    request.onProgress?.("ready");
  } catch (error) {
    request.onFailure?.(error);
    await runtime.removeContainers(request.runtime, [containerId]);
    throw error;
  }
  return { branch, clonePath, containerId, hostPort };
};
