import { join } from "node:path";
import { stopCurrentComparison } from "@/comparison/current-comparison";
import { runtimeAdapter } from "@/container-runtime/runtime";
import { loadRuntimeChoice } from "@/container-runtime/runtime-choice";
import type { RuntimeName } from "@/container-runtime/runtime-status";
import { gitHubRequestLog } from "@/github/request-log";
import {
  dataDirectory,
  gitHubRequestsDatabasePath,
} from "@/settings/data-directory";
import { settings } from "@/settings/settings";
import { killLiveCommands } from "@/shell/command-runner";
import { currentSessionId } from "./current-session";
import {
  registerExitCleanup,
  remainingInstances,
  removeAllInstances,
  removeLeftoverDirectories,
} from "./session";

/** Where each session keeps its clones. */
export const comparisonsDirectory = (): string =>
  join(dataDirectory(), "comparisons");

type RuntimeAvailability =
  | { kind: "ready"; runtime: RuntimeName }
  | { kind: "stopped"; runtime: RuntimeName }
  | { kind: "none" };

/** Whether the chosen Container Runtime can be asked about Instances right now. */
const runtimeAvailability = async (): Promise<RuntimeAvailability> => {
    const choice = await loadRuntimeChoice(
      runtimeAdapter,
      settings().getContainerRuntime()
    );
    if (choice.kind !== "use") {
      return { kind: "none" };
    }
    return choice.runtime.running
      ? { kind: "ready", runtime: choice.runtime.name }
      : { kind: "stopped", runtime: choice.runtime.name };
  },
  cannotVerify = (availability: RuntimeAvailability, when: string): void => {
    if (availability.kind === "stopped") {
      console.warn(
        `${availability.runtime} is not running; cannot verify Instances are stopped ${when}. Any it holds are stopped with it.`
      );
    } else if (availability.kind === "none") {
      console.warn(
        `No Container Runtime chosen; cannot verify Instances are stopped ${when}.`
      );
    }
  },
  /** On startup: remove every Leftover Instance and clone directory. */
  sweepOnStartup = async (): Promise<void> => {
    const directories = removeLeftoverDirectories(
      comparisonsDirectory(),
      currentSessionId
    );
    if (directories.length > 0) {
      console.info(
        `Removed ${directories.length} Leftover clone directory(ies).`
      );
    }
    const availability = await runtimeAvailability();
    if (availability.kind !== "ready") {
      cannotVerify(availability, "at startup");
      return;
    }
    const swept = await removeAllInstances(
      runtimeAdapter,
      availability.runtime
    );
    if (swept > 0) {
      console.info(`Removed ${swept} Leftover Instance(s).`);
    }
    await verifyNothingLeft(availability.runtime, "after the startup sweep");
  },
  /** On exit: stop the Comparison, kill running commands, remove every Instance, then check. */
  cleanUpOnExit = async (): Promise<void> => {
    await stopCurrentComparison().catch((error: unknown) => {
      console.error("Could not stop the current Comparison:", error);
    });
    const killed = killLiveCommands();
    if (killed > 0) {
      console.info(`Killed ${killed} running command(s).`);
    }
    removeLeftoverDirectories(comparisonsDirectory(), "");
    const availability = await runtimeAvailability();
    if (availability.kind === "ready") {
      const removed = await removeAllInstances(
        runtimeAdapter,
        availability.runtime
      );
      console.info(`Removed ${removed} Instance(s) on exit.`);
      await verifyNothingLeft(availability.runtime, "on exit");
    } else {
      cannotVerify(availability, "on exit");
    }
    console.info(
      `${gitHubRequestLog().count()} GitHub request(s) this session; see ${gitHubRequestsDatabasePath()}.`
    );
  },
  verifyNothingLeft = async (
    runtime: RuntimeName,
    when: string
  ): Promise<void> => {
    const remaining = await remainingInstances(runtimeAdapter, runtime);
    if (remaining.length > 0) {
      console.error(
        `${remaining.length} Instance(s) still present ${when}: ${remaining.join(", ")}. Remove them with \`${runtime} rm -f ${remaining.join(" ")}\`.`
      );
    }
  };

/**
 * Sweeps Leftovers and arranges removal of every Instance on exit.
 *
 * Next.js normally handles SIGINT/SIGTERM itself and exits within 100 ms, before a `docker rm` can
 * finish; the `dev` and `start` scripts set NEXT_MANUAL_SIG_HANDLE and NEXT_EXIT_TIMEOUT_MS so this
 * hook owns the exit instead.
 */
export const bootstrapSession = async (): Promise<void> => {
  try {
    await sweepOnStartup();
  } catch (error) {
    console.warn("Could not sweep Leftovers:", error);
  }
  registerExitCleanup(process, cleanUpOnExit);
};
