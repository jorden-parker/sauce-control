import type { RuntimeAdapter } from "@/container-runtime/runtime-adapter";
import type { RuntimeName } from "@/container-runtime/runtime-status";
import { SESSION_LABEL } from "./run-instance";

const EXIT_SIGNALS = ["SIGINT", "SIGTERM"] as const,
  ERROR_EXIT_CODE = 1,
  SIGNAL_EXIT_CODE = 130;

/** Removes the containers this session started. */
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

/** Removes containers left by any previous session, e.g. after a crash. Returns how many. */
export const sweepLeftovers = async (
  adapter: RuntimeAdapter,
  runtime: RuntimeName
): Promise<number> => {
  const ids = await adapter.listContainers(runtime, SESSION_LABEL);
  await adapter.removeContainers(runtime, ids);
  await adapter.removeImages(runtime, SESSION_LABEL);
  return ids.length;
};

/** The parts of `process` the exit hook needs, so tests can supply an emitter. */
export interface ProcessLike {
  exit: (code: number) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

/** Runs `cleanup` once on SIGINT, SIGTERM, or an uncaught error, then exits. */
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
      .catch(() => {
        // Cleanup is best effort on the way out.
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
