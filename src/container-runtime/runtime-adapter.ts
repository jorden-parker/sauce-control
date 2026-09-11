import type { RuntimeName, RuntimeStatus } from "./runtime-status";

/** Drives one Container Runtime through its shared CLI surface. */
export interface RuntimeAdapter {
  /** Installed? Version? Running? Never throws for an absent binary. */
  detect: (name: RuntimeName) => Promise<RuntimeStatus>;
  /** Kick off the runtime's VM/daemon (`podman machine start`, Docker Desktop). Resolves when the command returns, not when ready. */
  start: (name: RuntimeName) => Promise<void>;
}
