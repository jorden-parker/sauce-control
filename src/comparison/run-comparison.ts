import { detectSchemaSources } from "@/scenarios/detect-schema-sources";
import type { SchemaSource } from "@/scenarios/schema-sources";
import type { EndpointRecordings } from "@/endpoints/endpoint-recordings";
import {
  type Instance,
  type InstanceDependencies,
  type InstanceRequest,
  type InstanceStep,
  runInstance,
} from "@/instance/run-instance";
import { type Proxy, startProxy } from "@/proxy/proxy";
import {
  type ManualScenario,
  type Scenario,
  createScenarioCollection,
} from "@/scenarios/scenarios";

export interface ComparisonRequest extends Omit<
  InstanceRequest,
  "branch" | "onProgress" | "onFailure" | "onDetail"
> {
  onProgress?: (role: "base" | "target", step: InstanceStep) => void;
  onDetail?: (
    role: "base" | "target",
    step: InstanceStep,
    text: string
  ) => void;
  onFailure?: (error: unknown, role: "base" | "target") => void;
  manualScenarios?: ManualScenario[];
  schemaSources?: SchemaSource[];
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
  detectSchemaSources: (codeDirectory?: string) => Promise<SchemaSource[]>;
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
  {
    baseBranch,
    targetBranch,
    schemaSources,
    manualScenarios,
    onProgress,
    onDetail,
    onFailure,
    ...shared
  }: ComparisonRequest
): Promise<RunningComparison> => {
  const { recordings, runtime, localEndpointOrigins } = dependencies,
    collection = createScenarioCollection(schemaSources, manualScenarios),
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
    controller = new AbortController(),
    signal = shared.signal
      ? AbortSignal.any([shared.signal, controller.signal])
      : controller.signal;
  let failed = false,
    firstFailure: unknown;
  const failBranch = (error: unknown, role: "base" | "target") => {
      if (!failed && !shared.signal?.aborted) {
        failed = true;
        firstFailure = error;
        onFailure?.(error, role);
        controller.abort();
      }
    },
    outcomes = await Promise.allSettled(
      (["base", "target"] as const).map((role) =>
        runInstance(dependencies, {
          ...shared,
          branch: role === "base" ? baseBranch : targetBranch,
          onDetail: (step, text) => onDetail?.(role, step, text),
          onFailure: (error) => failBranch(error, role),
          onProgress: (step) => onProgress?.(role, step),
          signal,
        }).catch((error: unknown) => {
          failBranch(error, role);
          throw error;
        })
      )
    ),
    started = outcomes.flatMap((outcome) =>
      outcome.status === "fulfilled" ? [outcome.value] : []
    );
  if (failed || signal.aborted) {
    // Include containers whose CLI was interrupted before returning their id.
    const partial = await runtime.listContainers(
      shared.runtime,
      `sauce-control.session=${shared.sessionId}`
    );
    await runtime.removeContainers(shared.runtime, [
      ...new Set([
        ...partial,
        ...started.map((instance) => instance.containerId),
      ]),
    ]);
    await runtime.removeImages(
      shared.runtime,
      `sauce-control.session=${shared.sessionId}`
    );
    if (failed) {
      throw firstFailure;
    }
    signal.throwIfAborted();
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
  if (signal.aborted) {
    await proxy.close();
    await removeAll(started);
    signal.throwIfAborted();
  }
  return {
    base,
    detectSchemaSources: (codeDirectory) =>
      detectSchemaSources([
        base.clonePath,
        target.clonePath,
        codeDirectory ?? shared.codeDirectory ?? "",
      ]),
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
