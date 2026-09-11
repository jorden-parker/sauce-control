import { runtimeAdapter } from "@/container-runtime/runtime";
import type { RuntimeName } from "@/container-runtime/runtime-status";
import { loadRuntimeChoice } from "@/container-runtime/runtime-choice";
import { settings } from "@/settings/settings";
import { currentSessionId } from "./current-session";
import {
  registerExitCleanup,
  removeSessionContainers,
  sweepLeftovers,
} from "./session";

/** The chosen Container Runtime when it is installed and running; otherwise nothing to clean. */
const activeRuntime = async (): Promise<RuntimeName | undefined> => {
  const choice = await loadRuntimeChoice(
    runtimeAdapter,
    settings().getContainerRuntime()
  );
  return choice.kind === "use" && choice.runtime.running
    ? choice.runtime.name
    : undefined;
};

/** Sweeps containers left by a crashed session and arranges removal of this session's on exit. */
export const bootstrapSession = async (): Promise<void> => {
  try {
    const runtime = await activeRuntime();
    if (runtime !== undefined) {
      const swept = await sweepLeftovers(runtimeAdapter, runtime);
      if (swept > 0) {
        console.info(
          `Removed ${swept} container(s) left by a previous session.`
        );
      }
    }
  } catch (error) {
    console.warn("Could not sweep leftover containers:", error);
  }
  registerExitCleanup(process, async () => {
    const runtime = await activeRuntime();
    if (runtime !== undefined) {
      await removeSessionContainers(runtimeAdapter, runtime, currentSessionId);
    }
  });
};
