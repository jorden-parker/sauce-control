import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { RuntimeAdapter } from "@/container-runtime/runtime-adapter";
import type { RuntimeName } from "@/container-runtime/runtime-status";
import type { RepositoryConfig } from "@/settings/settings-store";
import type { GitHubRequestLog } from "@/github/request-log";
import type { CommandRunner } from "@/shell/command-runner";
import { cloneBranch } from "./clone-branch";
import { generateDockerfile } from "./dockerfile";
import {
  APP_LABEL,
  BRANCH_LABEL,
  REPOSITORY_LABEL,
  SESSION_LABEL,
  appLabelValue,
} from "./labels";

export { BRANCH_LABEL, SESSION_LABEL } from "./labels";

export interface InstanceRequest {
  branch: string;
  codeDirectory?: string | undefined;
  config: RepositoryConfig;
  environment: Record<string, string>;
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
    name: RuntimeName
  ): Promise<void> => {
    const status = await adapter.detect(name);
    if (!status.installed) {
      throw new Error(`${name} is not installed. Install it and try again.`);
    }
    if (!status.running) {
      throw new Error(
        `${name} is not running. Start it from Settings and try again.`
      );
    }
  },
  waitUntilListening = async (
    adapter: RuntimeAdapter,
    { branch, config, readiness, runtime }: InstanceRequest,
    containerId: string
  ): Promise<void> => {
    const deadline = Date.now() + readiness.timeoutMs,
      poll = async (): Promise<void> => {
        if (await adapter.isListening(runtime, containerId, config.port)) {
          return;
        }
        if (Date.now() >= deadline) {
          await adapter.removeContainers(runtime, [containerId]);
          throw new Error(
            `${branch} did not listen on port ${config.port} within ${readiness.timeoutMs}ms. Check the start command and try again.`
          );
        }
        await sleep(readiness.pollIntervalMs);
        await poll();
      };
    await poll();
  };

/** Clone, build, and start one branch as an Instance; resolves once it listens on its port. */
export const runInstance = async (
  { git, requestLog, runtime }: InstanceDependencies,
  request: InstanceRequest
): Promise<Instance> => {
  const { branch, config, environment, repository, sessionId } = request,
    clonePath = join(request.workDirectory, slug(branch)),
    tag = `sauce-control/${slug(repository)}-${slug(branch)}:${slug(sessionId)}`,
    ownership = { [APP_LABEL]: appLabelValue(), [SESSION_LABEL]: sessionId };

  await assertRunning(runtime, request.runtime);
  await cloneBranch(
    git,
    {
      branch,
      codeDirectory: request.codeDirectory,
      destination: clonePath,
      organisation: request.organisation,
      repository,
      token: request.token,
    },
    requestLog
  );
  await runtime.buildImage(request.runtime, {
    context: clonePath,
    dockerfile: existsSync(join(clonePath, "Dockerfile"))
      ? undefined
      : generateDockerfile(config),
    labels: ownership,
    tag,
  });
  const { containerId, hostPort } = await runtime.runContainer(
    request.runtime,
    {
      environment,
      image: tag,
      labels: {
        ...ownership,
        [BRANCH_LABEL]: branch,
        [REPOSITORY_LABEL]: repository,
      },
      port: config.port,
    }
  );
  await waitUntilListening(runtime, request, containerId);
  return { branch, clonePath, containerId, hostPort };
};
