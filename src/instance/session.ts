import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeAdapter } from "@/container-runtime/runtime-adapter";
import type { RuntimeName } from "@/container-runtime/runtime-status";
import { SESSION_LABEL, appLabel } from "./labels";

const EXIT_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const,
  ERROR_EXIT_CODE = 1,
  SIGNAL_EXIT_CODE = 130;

/** Removes the containers and images this session started. */
export const removeSessionContainers = async (
  adapter: RuntimeAdapter,
  runtime: RuntimeName,
  sessionId: string
): Promise<void> => {
  const label = `${SESSION_LABEL}=${sessionId}`,
    ids = await adapter.listContainers(runtime, label);
  await adapter.removeContainers(runtime, ids);
  await adapter.removeImages(runtime, label);
};

/**
 * Removes every Instance and image this Sauce Control owns, whichever session started them.
 * On startup that is the Leftovers of a crashed run; on exit it is everything. Returns how many containers went.
 */
export const removeAllInstances = async (
  adapter: RuntimeAdapter,
  runtime: RuntimeName
): Promise<number> => {
  const ids = await adapter.listContainers(runtime, appLabel());
  await adapter.removeContainers(runtime, ids);
  await adapter.removeImages(runtime, appLabel());
  return ids.length;
};

/** Ids of containers this Sauce Control owns that still exist; empty means everything is stopped. */
export const remainingInstances = (
  adapter: RuntimeAdapter,
  runtime: RuntimeName
): Promise<string[]> => adapter.listContainers(runtime, appLabel());

/** Deletes clone directories of every session but `keepSessionId`. Returns the session ids removed. */
export const removeLeftoverDirectories = (
  comparisonsDirectory: string,
  keepSessionId: string
): string[] => {
  if (!existsSync(comparisonsDirectory)) {
    return [];
  }
  const leftovers = readdirSync(comparisonsDirectory).filter(
    (entry) => entry !== keepSessionId
  );
  for (const entry of leftovers) {
    rmSync(join(comparisonsDirectory, entry), { force: true, recursive: true });
  }
  return leftovers;
};

/** The parts of `process` the exit hook needs, so tests can supply an emitter. */
export interface ProcessLike {
  exit: (code: number) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

/** Runs `cleanup` once on SIGINT, SIGTERM, SIGHUP, or an uncaught error, then exits. */
export const registerExitCleanup = (
  process: ProcessLike,
  cleanup: () => Promise<void>
): void => {
  let started = false;
  const exitAfterCleanup = (code: number) => {
    if (started) {
      return;
    }
    started = true;
    cleanup()
      .catch((error: unknown) => {
        console.error("Cleanup on exit failed:", error);
      })
      .finally(() => {
        process.exit(code);
      });
  };
  for (const signal of EXIT_SIGNALS) {
    process.on(signal, () => {
      exitAfterCleanup(SIGNAL_EXIT_CODE);
    });
  }
  process.on("uncaughtException", (error) => {
    console.error(error);
    exitAfterCleanup(ERROR_EXIT_CODE);
  });
};
