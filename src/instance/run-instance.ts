import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { RuntimeAdapter } from "@/container-runtime/runtime-adapter";
import type { RuntimeName } from "@/container-runtime/runtime-status";
import type { RepositoryConfig } from "@/settings/settings-store";
import type { CommandRunner } from "@/shell/command-runner";
import { cloneBranch } from "./clone-branch";
import { generateDockerfile } from "./dockerfile";

export const BRANCH_LABEL = "sauce-control.branch",
  SESSION_LABEL = "sauce-control.session";

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
  { git, runtime }: InstanceDependencies,
  request: InstanceRequest
): Promise<Instance> => {
  const { branch, config, environment, repository, sessionId } = request,
    clonePath = join(request.workDirectory, slug(branch)),
    tag = `sauce-control/${slug(repository)}-${slug(branch)}:${slug(sessionId)}`;

  await assertRunning(runtime, request.runtime);
  await cloneBranch(git, {
    branch,
    codeDirectory: request.codeDirectory,
    destination: clonePath,
    organisation: request.organisation,
    repository,
    token: request.token,
  });
  await runtime.buildImage(request.runtime, {
    context: clonePath,
    dockerfile: existsSync(join(clonePath, "Dockerfile"))
      ? undefined
      : generateDockerfile(config),
    labels: { [SESSION_LABEL]: sessionId },
    tag,
  });
  const { containerId, hostPort } = await runtime.runContainer(
    request.runtime,
    {
      environment,
      image: tag,
      labels: { [BRANCH_LABEL]: branch, [SESSION_LABEL]: sessionId },
      port: config.port,
    }
  );
  await waitUntilListening(runtime, request, containerId);
  return { branch, clonePath, containerId, hostPort };
};
