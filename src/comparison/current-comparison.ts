import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runtimeAdapter } from "@/container-runtime/runtime";
import { gitHubToken } from "@/github/github";
import { currentSessionId } from "@/instance/current-session";
import { keychain } from "@/keychain";
import { loadEnvironment } from "@/repository-config/environment";
import { dataDirectory } from "@/settings/data-directory";
import { settings } from "@/settings/settings";
import { nodeCommandRunner } from "@/shell/command-runner";
import { type RunningComparison, runComparison } from "./run-comparison";

/** What the Compare page shows about the one Comparison this process can run at a time. */
export type ComparisonStatus =
  | { kind: "idle" }
  | { kind: "starting"; repository: string }
  | { kind: "failed"; message: string }
  | {
      kind: "running";
      repository: string;
      urls: { base: string; target: string };
    };

const READINESS = { pollIntervalMs: 1000, timeoutMs: 10 * 60 * 1000 },
  useStub = (): boolean => process.env.SAUCE_CONTROL_COMPARISON === "stub";

let status: ComparisonStatus = { kind: "idle" },
  running: RunningComparison | undefined,
  workDirectory: string | undefined;

export const currentComparison = (): ComparisonStatus => status;

/** Whether Run can be pressed: a Container Runtime is chosen (or the runner is stubbed). */
export const canRunComparison = (): boolean =>
  useStub() || settings().getContainerRuntime() !== undefined;

/** Everything the runner needs, gathered from settings, the keychain, and the GitHub credential. */
const gather = async () => {
    const store = settings(),
      selection = store.getComparisonSelection(),
      organisation = store.getOrganisation(),
      runtime = store.getContainerRuntime(),
      token = await gitHubToken();
    if (selection === undefined) {
      throw new Error("Save a Comparison first.");
    }
    if (useStub()) {
      return { ...selection };
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
  },
  stubRun = (): Promise<RunningComparison> =>
    Promise.resolve({
      base: { branch: "", clonePath: "", containerId: "", hostPort: 0 },
      proxy: {
        close: () => Promise.resolve(),
        port: 0,
        urlFor: (role) => `http://127.0.0.1:0/${role}/`,
      },
      stop: () => Promise.resolve(),
      target: { branch: "", clonePath: "", containerId: "", hostPort: 0 },
    });

/** Starts the saved Comparison in the background; the status reports progress. */
export const startCurrentComparison = async (): Promise<void> => {
  if (status.kind === "starting" || status.kind === "running") {
    return;
  }
  try {
    const request = await gather();
    status = { kind: "starting", repository: request.repository };
    workDirectory = join(dataDirectory(), "comparisons", currentSessionId);
    mkdirSync(workDirectory, { recursive: true });
    const run =
      "config" in request
        ? runComparison(
            { git: nodeCommandRunner, runtime: runtimeAdapter },
            { ...request, workDirectory }
          )
        : stubRun();
    run
      .then((comparison) => {
        running = comparison;
        status = {
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
