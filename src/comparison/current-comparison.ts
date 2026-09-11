import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runtimeAdapter } from "@/container-runtime/runtime";
import { loadRuntimeChoice } from "@/container-runtime/runtime-choice";
import type { RuntimeName } from "@/container-runtime/runtime-status";
import { endpointRecordings } from "@/endpoints/endpoint-recordings";
import { gitHubToken } from "@/github/github";
import { currentSessionId } from "@/instance/current-session";
import { keychain } from "@/keychain";
import { loadEnvironment } from "@/repository-config/environment";
import {
  EnvironmentFileError,
  readEnvironmentFiles,
  validateInstanceEnvironment,
} from "@/repository-config/environment-files";
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
import { type ScenarioName, isScenarioName } from "@/scenarios/scenario-name";

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
      scenario: ScenarioName;
      mockedEndpoints: number;
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
  const choice = await loadRuntimeChoice(runtimeAdapter, saved);
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
    throw new EnvironmentFileError("Save a Comparison first.");
  }
  const loaded = await readEnvironmentFiles(
    store.getEnvironmentFiles(selection.repository),
    loadEnvironment(keychain, selection.repository)
  );
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
    throw new EnvironmentFileError("Save a GitHub Organisation first.");
  }
  if (runtime === undefined) {
    throw new EnvironmentFileError(
      "Choose a Container Runtime in Settings first."
    );
  }
  if (token === undefined) {
    throw new EnvironmentFileError("No GitHub credential found.");
  }
  // Each Instance discovers commands from its branch's manifest. Explicit
  // Repository settings are overrides, not a prerequisite for that discovery.
  const config = store.getRepositoryConfig(selection.repository) ?? {
    crawl: DEFAULT_CRAWL_LIMITS,
    installCommand: "",
    pages: DEFAULT_MANUAL_PAGES,
    port: 3000,
    startCommand: "",
  };
  validateInstanceEnvironment(loaded.environment, config.port);
  return {
    ...selection,
    codeDirectory: store.getCodeDirectory(),
    config,
    environment: loaded.environment,
    environmentFiles: loaded.resolvedPaths,
    organisation,
    readiness: READINESS,
    runtime,
    sessionId: currentSessionId,
    token,
  };
};

/** Starts the saved Comparison in the background; the status reports progress. */
export const startCurrentComparison = async (
  scenarioName: ScenarioName = "recorded"
): Promise<void> => {
  if (status.kind === "starting" || status.kind === "running") {
    return;
  }
  status = {
    kind: "starting",
    repository: settings().getComparisonSelection()?.repository ?? "",
    stage: "instances",
  };
  try {
    if (!isScenarioName(scenarioName)) {
      throw new Error("Choose a valid Scenario.");
    }
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
              recordings: endpointRecordings(),
              requestLog: gitHubRequestLog(),
              runtime: runtimeAdapter,
            },
            { ...request, workDirectory }
          )
        : runStubComparison({
            recordings: endpointRecordings(),
            repository: request.repository,
          });
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
          ),
          scenario = comparison
            .scenarios()
            .find(({ name }) => name === scenarioName);
        comparison.proxy.setScenario(scenario);
        status = {
          affected,
          discovery,
          kind: "running",
          mockedEndpoints: scenario?.responses.length ?? 0,
          repository: request.repository,
          scenario: scenarioName,
          urls: {
            base: comparison.proxy.urlFor("base"),
            target: comparison.proxy.urlFor("target"),
          },
        };
      })
      .catch(async (error: Error) => {
        await running?.stop().catch(() => {});
        running = undefined;
        if (workDirectory) {
          rmSync(workDirectory, { recursive: true, force: true });
        }
        workDirectory = undefined;
        status = {
          kind: "failed",
          message:
            error instanceof EnvironmentFileError
              ? error.message
              : "Could not start the Comparison. Check the development commands, credentials and Container Runtime. Raw logs are suppressed.",
        };
      });
  } catch (error) {
    status = {
      kind: "failed",
      message:
        error instanceof EnvironmentFileError
          ? error.message
          : "Could not load the Comparison configuration. Check Repository settings and credentials.",
    };
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
