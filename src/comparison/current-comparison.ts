import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runtimeAdapter } from "@/container-runtime/runtime";
import { loadRuntimeChoice } from "@/container-runtime/runtime-choice";
import type { RuntimeName } from "@/container-runtime/runtime-status";
import { gitHubToken } from "@/github/github";
import { currentSessionId } from "@/instance/current-session";
import { keychain } from "@/keychain";
import { loadEnvironment } from "@/repository-config/environment";
import { dataDirectory } from "@/settings/data-directory";
import { settings } from "@/settings/settings";
import { gitHubRequestLog } from "@/github/request-log";
import { type CommandRunner, nodeCommandRunner } from "@/shell/command-runner";
import {
  type AffectedPages,
  detectAffectedPages,
} from "./detect-affected-pages";
import { type Discovery, discoverPages } from "./discover-pages";
import { type RunningComparison, runComparison } from "./run-comparison";
import { DEFAULT_CRAWL_LIMITS } from "@/crawler/crawl-limits";
import { DEFAULT_MANUAL_PAGES } from "@/settings/settings-store";
import { runStubComparison } from "./stub-comparison";

/** What the Compare page shows about the one Comparison this process can run at a time. */
export type ComparisonStatus =
  | { kind: "idle" }
  | { kind: "starting"; repository: string; stage: ComparisonStage }
  | { kind: "failed"; message: string }
  | {
      affected: AffectedPages;
      discovery: Discovery;
      kind: "running";
      repository: string;
      urls: { base: string; target: string };
    };

/** What the runner is busy with before a Comparison is up. */
export type ComparisonStage = "instances" | "discovery" | "affected";

const READINESS = { pollIntervalMs: 1000, timeoutMs: 10 * 60 * 1000 },
  useStub = (): boolean => process.env.SAUCE_CONTROL_COMPARISON === "stub",
  /** The stub has no clones to diff, so nothing changed and detection falls back to every Page. */
  stubGit: CommandRunner = { run: () => Promise.resolve({ stdout: "" }) };

let status: ComparisonStatus = { kind: "idle" },
  running: RunningComparison | undefined,
  workDirectory: string | undefined;

export const currentComparison = (): ComparisonStatus => status;

/**
 * The saved Container Runtime, or the only installed one, which ADR 0001 says is used silently
 * and remembered. Detection runs once: after that the saved name answers without shelling out.
 */
const chosenContainerRuntime = async (): Promise<RuntimeName | undefined> => {
  const store = settings(),
    saved = store.getContainerRuntime();
  if (saved !== undefined) {
    return saved;
  }
  const choice = await loadRuntimeChoice(runtimeAdapter);
  if (choice.kind !== "use") {
    return undefined;
  }
  store.saveContainerRuntime(choice.runtime.name);
  return choice.runtime.name;
};

/** Whether Run can be pressed: a Container Runtime is chosen (or the runner is stubbed). */
export const canRunComparison = async (): Promise<boolean> =>
  useStub() || (await chosenContainerRuntime()) !== undefined;

/** Everything the runner needs, gathered from settings, the keychain, and the GitHub credential. */
const gather = async () => {
  const store = settings(),
    selection = store.getComparisonSelection(),
    organisation = store.getOrganisation(),
    runtime = await chosenContainerRuntime(),
    token = await gitHubToken();
  if (selection === undefined) {
    throw new Error("Save a Comparison first.");
  }
  if (useStub()) {
    return {
      ...selection,
      discovery: store.getRepositoryConfig(selection.repository) ?? {
        crawl: DEFAULT_CRAWL_LIMITS,
        pages: DEFAULT_MANUAL_PAGES,
      },
    };
  }
  if (organisation === undefined) {
    throw new Error("Save a GitHub Organisation first.");
  }
  if (runtime === undefined) {
    throw new Error("Choose a Container Runtime in Settings first.");
  }
  if (token === undefined) {
    throw new Error("No GitHub credential found.");
  }
  const config = store.getRepositoryConfig(selection.repository);
  if (config === undefined) {
    throw new Error(`Configure ${selection.repository} first.`);
  }
  return {
    ...selection,
    codeDirectory: store.getCodeDirectory(),
    config,
    environment: loadEnvironment(keychain, selection.repository),
    organisation,
    readiness: READINESS,
    runtime,
    sessionId: currentSessionId,
    token,
  };
};

/** Starts the saved Comparison in the background; the status reports progress. */
export const startCurrentComparison = async (): Promise<void> => {
  if (status.kind === "starting" || status.kind === "running") {
    return;
  }
  try {
    const request = await gather();
    status = {
      kind: "starting",
      repository: request.repository,
      stage: "instances",
    };
    workDirectory = join(dataDirectory(), "comparisons", currentSessionId);
    mkdirSync(workDirectory, { recursive: true });
    const run =
      "config" in request
        ? runComparison(
            {
              git: nodeCommandRunner,
              requestLog: gitHubRequestLog(),
              runtime: runtimeAdapter,
            },
            { ...request, workDirectory }
          )
        : runStubComparison();
    run
      .then(async (comparison) => {
        running = comparison;
        status = {
          kind: "starting",
          repository: request.repository,
          stage: "discovery",
        };
        const discovery = await discoverPages(
          comparison,
          "config" in request ? request.config : request.discovery
        );
        status = {
          kind: "starting",
          repository: request.repository,
          stage: "affected",
        };
        const affected = await detectAffectedPages(
          "config" in request ? nodeCommandRunner : stubGit,
          comparison,
          discovery
        );
        status = {
          affected,
          discovery,
          kind: "running",
          repository: request.repository,
          urls: {
            base: comparison.proxy.urlFor("base"),
            target: comparison.proxy.urlFor("target"),
          },
        };
      })
      .catch((error: Error) => {
        status = { kind: "failed", message: error.message };
      });
  } catch (error) {
    status = { kind: "failed", message: (error as Error).message };
  }
};

/** Points the Proxy at a restarted Instance's new host port, when the container belongs to this Comparison. */
export const updateInstancePort = (
  containerId: string,
  hostPort: number
): void => {
  for (const instance of [running?.base, running?.target]) {
    if (instance?.containerId === containerId) {
      instance.hostPort = hostPort;
    }
  }
};

/** Stops the running Comparison: closes the Proxy, removes both containers, deletes the clones. */
export const stopCurrentComparison = async (): Promise<void> => {
  const comparison = running;
  running = undefined;
  status = { kind: "idle" };
  await comparison?.stop();
  if (workDirectory !== undefined) {
    rmSync(workDirectory, { force: true, recursive: true });
    workDirectory = undefined;
  }
};
