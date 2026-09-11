import { setTimeout as sleep } from "node:timers/promises";
import type { RuntimeAdapter } from "./runtime-adapter";
import type { RuntimeName, RuntimeStatus } from "./runtime-status";

export interface StartOptions {
  pollIntervalMs: number;
  timeoutMs: number;
}

/** How a reviewer starts each runtime by hand, for error messages. */
export const MANUAL_START_HINT: Record<RuntimeName, string> = {
  docker: "Open Docker Desktop",
  podman: "Run `podman machine start`",
};

const isRunning = (status: RuntimeStatus): boolean =>
  status.installed && status.running;

/** Start a stopped Container Runtime and wait until it reports running. */
export const startRuntime = async (
  adapter: RuntimeAdapter,
  name: RuntimeName,
  { pollIntervalMs, timeoutMs }: StartOptions
): Promise<RuntimeStatus> => {
  await adapter.start(name);
  const deadline = Date.now() + timeoutMs;
  let status = await adapter.detect(name);
  while (!isRunning(status)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `${name} did not become ready within ${timeoutMs}ms. ${MANUAL_START_HINT[name]} and try again.`
      );
    }
    // oxlint-disable-next-line no-await-in-loop -- readiness polling is sequential by nature
    await sleep(pollIntervalMs);
    // oxlint-disable-next-line no-await-in-loop -- readiness polling is sequential by nature
    status = await adapter.detect(name);
  }
  return status;
};
