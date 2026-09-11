import { describe, expect, it } from "vitest";
import type { RuntimeAdapter } from "./runtime-adapter";
import type { RuntimeName, RuntimeStatus } from "./runtime-status";
import { startRuntime } from "./start-runtime";

/** Fake adapter: reports stopped until `start` is called, then running after `pollsUntilReady` detects. */
const fakeAdapter = ({
    pollsUntilReady = 0,
    startFails = false,
  }: {
    pollsUntilReady?: number;
    startFails?: boolean;
  } = {}): RuntimeAdapter & {
    starts: RuntimeName[];
  } => {
    let polls = 0,
      started = false;
    const starts: RuntimeName[] = [];
    return {
      detect: (name): Promise<RuntimeStatus> => {
        polls += started ? 1 : 0;
        return Promise.resolve({
          installed: true,
          name,
          running: started && polls > pollsUntilReady,
          version: "5.0.0",
        });
      },
      start: (name) => {
        starts.push(name);
        if (startFails) {
          return Promise.reject(new Error("podman machine start: no machine"));
        }
        started = true;
        return Promise.resolve();
      },
      starts,
    };
  },
  immediately = { pollIntervalMs: 0, timeoutMs: 1000 };

describe("starting a stopped Container Runtime", () => {
  it("starts it and resolves once the runtime reports running", async () => {
    const adapter = fakeAdapter({ pollsUntilReady: 2 }),
      status = await startRuntime(adapter, "podman", immediately);
    expect(adapter.starts).toEqual(["podman"]);
    expect(status).toEqual({
      installed: true,
      name: "podman",
      running: true,
      version: "5.0.0",
    });
  });
});

describe("a Container Runtime that never becomes ready", () => {
  it("fails with an error naming the runtime and how to start it by hand", async () => {
    const adapter = fakeAdapter({ pollsUntilReady: Number.POSITIVE_INFINITY });
    await expect(
      startRuntime(adapter, "podman", { pollIntervalMs: 1, timeoutMs: 20 })
    ).rejects.toThrow(
      "podman did not become ready within 20ms. Check it is running and try again."
    );
  });

  it("surfaces the start command's own failure", async () => {
    const adapter = fakeAdapter({ startFails: true });
    await expect(startRuntime(adapter, "podman", immediately)).rejects.toThrow(
      "podman machine start: no machine"
    );
  });
});
