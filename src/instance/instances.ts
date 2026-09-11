import type { RuntimeAdapter } from "@/container-runtime/runtime-adapter";
import type { RuntimeName } from "@/container-runtime/runtime-status";
import {
  BRANCH_LABEL,
  REPOSITORY_LABEL,
  SESSION_LABEL,
  appLabel,
} from "./labels";

/** One Instance as the Container Runtime reports it, whether or not this process started it. */
export interface InstanceSummary {
  branch: string;
  containerId: string;
  createdAt: string;
  hostPort: number | undefined;
  /** Started by an earlier Sauce Control that has since exited. */
  leftover: boolean;
  repository: string;
  state: "running" | "stopped";
}

/** Every Instance this Sauce Control owns, newest first, straight from the runtime so Leftovers show too. */
export const listInstances = async (
  adapter: RuntimeAdapter,
  runtime: RuntimeName,
  currentSessionId: string
): Promise<InstanceSummary[]> => {
  const ids = await adapter.listContainers(runtime, appLabel()),
    details = await adapter.inspectContainers(runtime, ids);
  return details
    .map(({ containerId, createdAt, hostPort, labels, state }) => ({
      branch: labels[BRANCH_LABEL] ?? "?",
      containerId,
      createdAt,
      hostPort,
      leftover: labels[SESSION_LABEL] !== currentSessionId,
      repository: labels[REPOSITORY_LABEL] ?? "?",
      state,
    }))
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
};

/** Only containers this Sauce Control owns may be touched by id from the UI. */
const assertOwned = async (
  adapter: RuntimeAdapter,
  runtime: RuntimeName,
  containerId: string
): Promise<void> => {
  const owned = await adapter.listContainers(runtime, appLabel());
  if (!owned.includes(containerId)) {
    throw new Error(`No Instance with container id ${containerId}.`);
  }
};

export const stopInstance = async (
  adapter: RuntimeAdapter,
  runtime: RuntimeName,
  containerId: string
): Promise<void> => {
  await assertOwned(adapter, runtime, containerId);
  await adapter.stopContainers(runtime, [containerId]);
};

/** Starts a stopped Instance again and returns the host port it now publishes. */
export const startInstance = async (
  adapter: RuntimeAdapter,
  runtime: RuntimeName,
  containerId: string
): Promise<number | undefined> => {
  await assertOwned(adapter, runtime, containerId);
  await adapter.startContainers(runtime, [containerId]);
  const [details] = await adapter.inspectContainers(runtime, [containerId]);
  return details?.hostPort;
};
