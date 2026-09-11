import type { EndpointRecordings } from "@/endpoints/endpoint-recordings";
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

export interface ComparisonDependencies extends InstanceDependencies {
  /** Where the Endpoint calls of both Instances are recorded, under the Comparison's Repository. */
  recordings?: EndpointRecordings;
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
  dependencies: ComparisonDependencies,
  { baseBranch, targetBranch, ...shared }: ComparisonRequest
): Promise<RunningComparison> => {
  const { recordings, runtime } = dependencies,
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
    proxy = await startProxy({
      instances: { base, target },
      ...(recordings === undefined
        ? {}
        : {
            recordEndpoint: (call) =>
              recordings.record(shared.repository, call),
          }),
    });
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
