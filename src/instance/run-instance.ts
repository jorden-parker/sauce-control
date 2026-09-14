import { ComparisonStartError } from "@/comparison/comparison-start-error";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  BuildSecret,
  RuntimeAdapter,
} from "@/container-runtime/runtime-adapter";
import type { RuntimeName } from "@/container-runtime/runtime-status";
import type { RepositoryConfig } from "@/settings/settings-store";
import type { GitHubRequestLog } from "@/github/request-log";
import type { CommandRunner } from "@/shell/command-runner";
import { buildFailureMessage } from "./build-diagnostics";
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
  | "ready";

export interface InstanceRequest {
  signal?: AbortSignal;
  onProgress?: (step: InstanceStep) => void;
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

export interface InstanceDependencies {
  git: CommandRunner;
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
      throw new ComparisonStartError(
        `${name} is not running. Start it from Settings and try again.`
      );
    }
  },
  waitUntilListening = async (
    adapter: RuntimeAdapter,
    { branch, config, readiness, runtime, signal }: InstanceRequest,
    containerId: string
  ): Promise<void> => {
    const deadline = Date.now() + readiness.timeoutMs,
      poll = async (): Promise<void> => {
        signal?.throwIfAborted();
        if (
          await adapter.isListening(runtime, containerId, config.port, signal)
        ) {
          return;
        }
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
  /** Clone, build, and start one branch as an Instance; resolves once it listens on its port. */
  /** Registry credentials the Dockerfile's install step mounts; absent variables are simply not mounted. */
  BUILD_SECRET_IDS = ["NODE_AUTH_TOKEN", "NPM_REGISTRY"] as const,
  buildSecrets = (environment: Record<string, string>): BuildSecret[] =>
    BUILD_SECRET_IDS.flatMap((id) => {
      const value = environment[id];
      return value === undefined ? [] : [{ id, value }];
    });

export const runInstance = async (
  { git, requestLog, runtime }: InstanceDependencies,
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
    secrets = buildSecrets(environment);
  try {
    await runtime.buildImage(request.runtime, {
      context,
      dockerfile: generateDockerfile(undefined, {
        registryAuth: secrets.some(({ id }) => id === "NODE_AUTH_TOKEN"),
      }),
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
    await waitUntilListening(runtime, request, containerId);
    request.signal?.throwIfAborted();
    request.onProgress?.("ready");
  } catch (error) {
    request.onFailure?.(error);
    await runtime.removeContainers(request.runtime, [containerId]);
    throw error;
  }
  return { branch, clonePath, containerId, hostPort };
};
