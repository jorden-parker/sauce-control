import { describe, expect, it } from "vitest";
import type {
  ContainerDetails,
  RuntimeAdapter,
} from "@/container-runtime/runtime-adapter";
import { listInstances, startInstance, stopInstance } from "./instances";

const OURS = { "sauce-control.app": "sauce-control" },
  /** Fake docker whose containers can be stopped and started; a start publishes a new port. */
  fakeRuntime = (containers: ContainerDetails[]) => {
    const store = new Map(containers.map((c) => [c.containerId, { ...c }])),
      adapter = {
        inspectContainers: (_name, ids) =>
          Promise.resolve(
            ids.flatMap((id) => {
              const found = store.get(id);
              return found === undefined ? [] : [found];
            })
          ),
        listContainers: (_name, label) => {
          const [key, value] = label.split("=");
          return Promise.resolve(
            [...store.values()]
              .filter((c) => key !== undefined && c.labels[key] === value)
              .map((c) => c.containerId)
          );
        },
        startContainers: (_name, ids) => {
          for (const id of ids) {
            const found = store.get(id);
            if (found) {
              found.state = "running";
              found.hostPort = 50_000;
            }
          }
          return Promise.resolve();
        },
        stopContainers: (_name, ids) => {
          for (const id of ids) {
            const found = store.get(id);
            if (found) {
              found.state = "stopped";
              found.hostPort = undefined;
            }
          }
          return Promise.resolve();
        },
      } as Pick<
        RuntimeAdapter,
        | "inspectContainers"
        | "listContainers"
        | "startContainers"
        | "stopContainers"
      > as RuntimeAdapter;
    return { adapter, store };
  },
  container = (
    id: string,
    session: string,
    createdAt: string,
    extra: Partial<ContainerDetails> = {}
  ): ContainerDetails => ({
    containerId: id,
    createdAt,
    hostPort: 49_152,
    labels: {
      ...OURS,
      "sauce-control.branch": "main",
      "sauce-control.repository": "web-app",
      "sauce-control.session": session,
    },
    state: "running",
    ...extra,
  });

describe("listing Instances", () => {
  it("shows every owned container newest first and marks other sessions as Leftover", async () => {
    const runtime = fakeRuntime([
      container("old", "s0", "2026-09-11T09:00:00Z", { state: "stopped" }),
      container("mine", "s1", "2026-09-11T10:00:00Z"),
      {
        containerId: "foreign",
        createdAt: "2026-09-11T11:00:00Z",
        hostPort: 8080,
        labels: { "com.docker.compose.project": "x" },
        state: "running",
      },
    ]);
    await expect(
      listInstances(runtime.adapter, "docker", "s1")
    ).resolves.toEqual([
      {
        branch: "main",
        containerId: "mine",
        createdAt: "2026-09-11T10:00:00Z",
        hostPort: 49_152,
        leftover: false,
        repository: "web-app",
        state: "running",
      },
      {
        branch: "main",
        containerId: "old",
        createdAt: "2026-09-11T09:00:00Z",
        hostPort: 49_152,
        leftover: true,
        repository: "web-app",
        state: "stopped",
      },
    ]);
  });
});

describe("stopping and starting one Instance", () => {
  it("stops then starts an owned container and reports the new host port", async () => {
    const runtime = fakeRuntime([
      container("mine", "s1", "2026-09-11T10:00:00Z"),
    ]);
    await stopInstance(runtime.adapter, "docker", "mine");
    expect(runtime.store.get("mine")?.state).toBe("stopped");
    await expect(
      startInstance(runtime.adapter, "docker", "mine")
    ).resolves.toBe(50_000);
    expect(runtime.store.get("mine")?.state).toBe("running");
  });

  it("refuses containers this Sauce Control does not own", async () => {
    const runtime = fakeRuntime([
      {
        containerId: "foreign",
        createdAt: "",
        hostPort: 8080,
        labels: {},
        state: "running",
      },
    ]);
    await expect(
      stopInstance(runtime.adapter, "docker", "foreign")
    ).rejects.toThrow("No Instance with container id foreign.");
  });
});
