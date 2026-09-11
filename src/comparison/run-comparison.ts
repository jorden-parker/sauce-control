import type { EndpointRecordings } from "@/endpoints/endpoint-recordings";
import {
  type Instance,
  type InstanceDependencies,
  type InstanceRequest,
  runInstance,
} from "@/instance/run-instance";
import { type Proxy, startProxy } from "@/proxy/proxy";
import { type Scenario, createScenarioCollection } from "@/scenarios/scenarios";

export interface ComparisonRequest extends Omit<InstanceRequest, "branch"> {
  baseBranch: string;
  targetBranch: string;
}

export interface ComparisonDependencies extends InstanceDependencies {
  localEndpointOrigins?: string[];
  /** Where the Endpoint calls of both Instances are recorded, under the Comparison's Repository. */
  recordings?: EndpointRecordings;
}

/** Both Instances of a Comparison, up and reachable through the Proxy. */
export interface RunningComparison {
  base: Instance;
  proxy: Proxy;
  scenarios: () => Scenario[];
  /** Closes the Proxy and removes both containers. */
  stop: () => Promise<void>;
  target: Instance;
}

/** Builds and starts both branches concurrently, then fronts them with one Proxy. */
export const runComparison = async (
  dependencies: ComparisonDependencies,
  { baseBranch, targetBranch, ...shared }: ComparisonRequest
): Promise<RunningComparison> => {
  const { recordings, runtime, localEndpointOrigins } = dependencies,
    collection = createScenarioCollection(),
    removeAll = async (instances: Instance[]) => {
      await runtime.removeContainers(
        shared.runtime,
        instances.map((instance) => instance.containerId)
      );
      await runtime.removeImages(
        shared.runtime,
        `sauce-control.session=${shared.sessionId}`
      );
    },
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
      ...(localEndpointOrigins === undefined ? {} : { localEndpointOrigins }),
      recordEndpoint: (call) => {
        collection.record(call);
        recordings?.record(shared.repository, call);
      },
    }).catch(async (error: unknown) => {
      await removeAll(started);
      throw error;
    });
  return {
    base,
    proxy,
    scenarios: collection.scenarios,
    stop: async () => {
      try {
        await proxy.close();
      } finally {
        await removeAll([base, target]);
      }
    },
    target,
  };
};
