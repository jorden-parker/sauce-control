import {
  type Instance,
  type InstanceDependencies,
  type InstanceRequest,
  runInstance,
} from "@/instance/run-instance";
import { type Proxy, startProxy } from "@/proxy/proxy";

export interface ComparisonRequest extends Omit<InstanceRequest, "branch"> {
  baseBranch: string;
  targetBranch: string;
}

/** Both Instances of a Comparison, up and reachable through the Proxy. */
export interface RunningComparison {
  base: Instance;
  proxy: Proxy;
  /** Closes the Proxy and removes both containers. */
  stop: () => Promise<void>;
  target: Instance;
}

/** Builds and starts both branches concurrently, then fronts them with one Proxy. */
export const runComparison = async (
  dependencies: InstanceDependencies,
  { baseBranch, targetBranch, ...shared }: ComparisonRequest
): Promise<RunningComparison> => {
  const { runtime } = dependencies,
    removeAll = (instances: Instance[]) =>
      runtime.removeContainers(
        shared.runtime,
        instances.map((instance) => instance.containerId)
      ),
    outcomes = await Promise.allSettled(
      [baseBranch, targetBranch].map((branch) =>
        runInstance(dependencies, { ...shared, branch })
      )
    ),
    started = outcomes.flatMap((outcome) =>
      outcome.status === "fulfilled" ? [outcome.value] : []
    ),
    failure = outcomes.find((outcome) => outcome.status === "rejected");
  if (failure !== undefined) {
    await removeAll(started);
    throw failure.reason;
  }
  const [base, target] = started as [Instance, Instance],
    // The Instances themselves, so a restarted container's new host port reaches the Proxy.
    proxy = await startProxy({ instances: { base, target } });
  return {
    base,
    proxy,
    stop: async () => {
      await proxy.close();
      await removeAll([base, target]);
    },
    target,
  };
};
