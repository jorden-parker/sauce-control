import { randomUUID } from "node:crypto";
import {
  type ProgressScope,
  type StartupProgress,
  StartupProgressTracker,
} from "./startup-progress";
import { ComparisonStartError } from "./comparison-start-error";
import { detectSchemaSources } from "@/scenarios/detect-schema-sources";
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
import { isScenarioName } from "@/scenarios/scenario-name";
import {
  EnvironmentSetupError,
  runEnvironmentSetup,
} from "@/repository-config/environment-setup";

/** What the Compare page shows about the one Comparison this process can run at a time. */
export type ComparisonStatus =
  | { kind: "idle" }
  | { kind: "cancelled" }
  | { kind: "starting"; repository: string; stage: ComparisonStage }
  | { kind: "failed"; message: string }
  | {
      affected: AffectedPages;
      discovery: Discovery;
      kind: "running";
      repository: string;
      scenario: string;
      mockedEndpoints: number;
      urls: { base: string; target: string };
    };

/** What the runner is busy with before a Comparison is up. */
export type ComparisonStage = "instances" | "discovery" | "affected";

const READINESS = { pollIntervalMs: 1000, timeoutMs: 10 * 60 * 1000 },
  useStub = (): boolean => process.env.SAUCE_CONTROL_COMPARISON === "stub",
  /** The stub has no clones to diff, so nothing changed and detection falls back to every Page. */
  stubGit: CommandRunner = { run: () => Promise.resolve({ stdout: "" }) };

interface Attempt {
  controller: AbortController;
  progress: StartupProgressTracker;
  done: Promise<void>;
  runtime?: RuntimeName;
  complete: () => void;
  workDirectory?: string;
  comparison?: RunningComparison;
}
interface ComparisonState {
  status: ComparisonStatus;
  running?: RunningComparison;
  stopping?: Promise<void>;
  workDirectory?: string;
  attempt?: Attempt;
  progress?: StartupProgressTracker;
  listeners: Set<() => void>;
}
// Route Handlers and Server Components must observe the same process-owned run.
const processState = globalThis as typeof globalThis & {
    sauceComparisonState?: ComparisonState;
  },
  state = (processState.sauceComparisonState ??= {
    listeners: new Set(),
    status: { kind: "idle" },
  }),
  publish = () => {
    for (const listener of state.listeners) {
      listener();
    }
  };
export const currentComparison = (): ComparisonStatus => state.status;
export interface ComparisonSnapshot {
  status: ComparisonStatus;
  progress?: StartupProgress;
}
export const currentComparisonSnapshot = (): ComparisonSnapshot => ({
  progress: state.progress?.snapshot(),
  status: state.status,
});
export const subscribeComparison = (listener: () => void): (() => void) => {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
};
const setStatus = (status: ComparisonStatus) => {
    state.status = status;
    publish();
  },
  safeFailure = (error: unknown): string =>
    error instanceof EnvironmentFileError ||
    error instanceof EnvironmentSetupError ||
    error instanceof ComparisonStartError
      ? error.message
      : "Could not start the Comparison. Open Compare → Configure repository to check the installation command, development server command and Port; check Environment Files on Compare and Container Runtime in Settings. Raw logs are suppressed to protect credentials.",
  /**
   * The saved Container Runtime, or the only installed one, which ADR 0001 says is used silently
   * and remembered. Detection runs once: after that the saved name answers without shelling out.
   */
  chosenContainerRuntime = async (): Promise<RuntimeName | undefined> => {
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
      ...store.getScenarioConfig(selection.repository),
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
    ...store.getScenarioConfig(selection.repository),
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
  scenarioName: string = "recorded"
): Promise<void> => {
  if (state.attempt || state.stopping || state.status.kind === "running") {
    return;
  }
  const selection = settings().getComparisonSelection(),
    completion = Promise.withResolvers<void>(),
    attempt: Attempt = {
      complete: completion.resolve,
      controller: new AbortController(),
      done: completion.promise,
      progress: new StartupProgressTracker(
        randomUUID(),
        selection?.repository ?? "",
        {
          base: selection?.baseBranch ?? "",
          target: selection?.targetBranch ?? "",
        },
        publish
      ),
    };
  state.attempt = attempt;
  state.progress = attempt.progress;
  setStatus({
    kind: "starting",
    repository: selection?.repository ?? "",
    stage: "instances",
  });
  const { signal } = attempt.controller,
    fail = (error: unknown, scope?: ProgressScope) => {
      if (
        state.attempt !== attempt ||
        signal.aborted ||
        state.status.kind === "failed"
      ) {
        return;
      }
      const message = safeFailure(error);
      setStatus({ kind: "failed", message });
      attempt.progress.finish("failed", message, scope);
      attempt.progress.cleanup("pending");
    },
    clean = async () => {
      let failed = false;
      try {
        await attempt.comparison?.stop();
      } catch {
        failed = true;
      }
      if (attempt.workDirectory) {
        try {
          rmSync(attempt.workDirectory, { force: true, recursive: true });
        } catch {
          failed = true;
        }
      }
      // Retry a label sweep, including partial resources from interrupted runtime commands.
      if (!useStub()) {
        const { runtime } = attempt;
        if (runtime) {
          try {
            const ids = await runtimeAdapter.listContainers(
              runtime,
              `sauce-control.session=${currentSessionId}`
            );
            await runtimeAdapter.removeContainers(runtime, ids);
            await runtimeAdapter.removeImages(
              runtime,
              `sauce-control.session=${currentSessionId}`
            );
          } catch {
            failed = true;
          }
        }
      }
      attempt.progress.cleanup(failed ? "failed" : "complete");
    },
    finish = () => {
      if (state.attempt === attempt) {
        state.attempt = undefined;
      }
      attempt.complete();
      publish();
    };
  try {
    if (
      !isScenarioName(scenarioName) &&
      !settings()
        .getScenarioConfig(selection?.repository ?? "")
        .manualScenarios.some(({ name }) => name === scenarioName)
    ) {
      throw new Error("Choose a valid Scenario.");
    }
    const request = await gather(),
      setupCommand = settings().getRepositoryConfig(
        request.repository
      )?.environmentSetupCommand;
    attempt.runtime = "config" in request ? request.runtime : undefined;
    signal.throwIfAborted();
    attempt.workDirectory = join(
      dataDirectory(),
      "comparisons",
      currentSessionId
    );
    mkdirSync(attempt.workDirectory, { recursive: true });
    const work = async () => {
      try {
        let setupEnvironment: Record<string, string> | undefined;
        if (setupCommand?.trim()) {
          attempt.progress.beginEnvironmentSetup();
          setupEnvironment = await runEnvironmentSetup(setupCommand, {
            signal,
          });
          signal.throwIfAborted();
          if ("config" in request) {
            request.environment = {
              ...request.environment,
              ...setupEnvironment,
            };
            validateInstanceEnvironment(
              request.environment,
              request.config.port
            );
          }
          attempt.progress.completeEnvironmentSetup();
        }
        const comparison =
          "config" in request
            ? await runComparison(
                {
                  git: nodeCommandRunner,
                  recordings: endpointRecordings(),
                  requestLog: gitHubRequestLog(),
                  runtime: runtimeAdapter,
                },
                {
                  ...request,
                  onFailure: fail,
                  onProgress: (role, step) => {
                    if (!signal.aborted) attempt.progress.begin(role, step);
                  },
                  setupEnvironment,
                  signal,
                  workDirectory: attempt.workDirectory!,
                }
              )
            : await runStubComparison({
                manualScenarios: request.manualScenarios,
                recordings: endpointRecordings(),
                repository: request.repository,
                schemaSources: request.schemaSources,
              });
        attempt.comparison = comparison;
        signal.throwIfAborted();
        if (!("config" in request)) {
          for (const role of ["base", "target"] as const) {
            for (const step of [
              "clone",
              "container",
              "install",
              "start",
              "readiness",
              "ready",
            ] as const) {
              attempt.progress.begin(role, step);
            }
          }
        }
        setStatus({
          kind: "starting",
          repository: request.repository,
          stage: "discovery",
        });
        attempt.progress.begin("comparison", "discovery");
        const discovery = await discoverPages(
          comparison,
          "config" in request ? request.config : request.discovery,
          {
            onProgress: (role, visited) =>
              attempt.progress.detail(
                "comparison",
                "discovery",
                `${role === "base" ? "Base" : "Target"}: ${visited} Pages visited.`
              ),
            signal,
          }
        );
        signal.throwIfAborted();
        setStatus({
          kind: "starting",
          repository: request.repository,
          stage: "affected",
        });
        attempt.progress.begin("comparison", "affected");
        const affected = await detectAffectedPages(
          "config" in request ? nodeCommandRunner : stubGit,
          comparison,
          discovery,
          {
            onProgress: (completed, total) =>
              attempt.progress.detail(
                "comparison",
                "affected",
                `${completed} of ${total} Pages checked.`
              ),
            signal,
          }
        );
        signal.throwIfAborted();
        const scenario = comparison
          .scenarios()
          .find(({ name }) => name === scenarioName);
        comparison.proxy.setScenario(scenario);
        state.running = comparison;
        state.workDirectory = attempt.workDirectory;
        setStatus({
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
        });
        attempt.progress.finish("ready", "Comparison ready.");
      } catch (error) {
        fail(error);
        await clean();
      } finally {
        finish();
      }
    };
    void work();
  } catch (error) {
    fail(error);
    await clean();
    finish();
  }
};

/** Points the Proxy at a restarted Instance's new host port, when the container belongs to this Comparison. */
export const updateInstancePort = (
  containerId: string,
  hostPort: number
): void => {
  for (const instance of [state.running?.base, state.running?.target]) {
    if (instance?.containerId === containerId) {
      instance.hostPort = hostPort;
    }
  }
};

/** Stops the running Comparison: closes the Proxy, removes both containers, deletes the clones. */
export const stopCurrentComparison = async (): Promise<void> => {
  const { attempt } = state;
  if (attempt) {
    if (!attempt.controller.signal.aborted) {
      attempt.progress.finish("cancelled", "Comparison startup cancelled.");
      attempt.progress.cleanup("pending");
      if (state.status.kind !== "failed") {
        setStatus({ kind: "cancelled" });
      }
      attempt.controller.abort();
    }
    await attempt.done;
    return;
  }
  if (state.stopping) {
    await state.stopping;
    return;
  }
  const comparison = state.running;
  if (!comparison) {
    return;
  }
  const directory = state.workDirectory;
  state.running = undefined;
  state.workDirectory = undefined;
  state.progress?.cleanup("pending");
  setStatus({ kind: "idle" });
  state.stopping = (async () => {
    try {
      await comparison.stop();
      if (directory) {
        rmSync(directory, { force: true, recursive: true });
      }
      state.progress?.cleanup("complete");
    } catch {
      state.progress?.cleanup("failed");
    }
  })();
  try {
    await state.stopping;
  } finally {
    state.stopping = undefined;
    publish();
  }
};

/** Only the selected Repository's live clones and the reviewer's Code Directory. */
export const detectCurrentSchemaSources = async (
  repository: string,
  codeDirectory?: string
) =>
  state.running &&
  "repository" in state.status &&
  state.status.repository === repository
    ? state.running.detectSchemaSources(codeDirectory)
    : detectSchemaSources(codeDirectory ? [codeDirectory] : []);
