import { setTimeout as sleep } from "node:timers/promises";
import type { RuntimeAdapter } from "./runtime-adapter";
import type { RuntimeName, RuntimeStatus } from "./runtime-status";

export interface StartOptions {
  pollIntervalMs: number;
  timeoutMs: number;
}

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
        `${name} did not become ready within ${timeoutMs}ms. Check it is running and try again.`
      );
    }
    // oxlint-disable-next-line no-await-in-loop -- readiness polling is sequential by nature
    await sleep(pollIntervalMs);
    // oxlint-disable-next-line no-await-in-loop -- readiness polling is sequential by nature
    status = await adapter.detect(name);
  }
  return status;
};
