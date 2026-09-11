import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RuntimeAdapter } from "@/container-runtime/runtime-adapter";
import type { RuntimeName } from "@/container-runtime/runtime-status";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** In-memory Container Runtimes: docker installed and stopped, podman absent. */
const fake: RuntimeAdapter & { running: boolean; starts: RuntimeName[] } = {
  detect: (name) =>
    Promise.resolve(
      name === "docker"
        ? { installed: true, name, running: fake.running, version: "29.7.2" }
        : { installed: false, name }
    ),
  running: false,
  start: (name) => {
    fake.starts.push(name);
    fake.running = true;
    return Promise.resolve();
  },
  starts: [],
};
vi.mock("@/container-runtime/runtime", () => ({ runtimeAdapter: fake }));

process.env.SAUCE_CONTROL_DATA_DIR = mkdtempSync(
  join(tmpdir(), "sauce-control-actions-")
);

const form = (entries: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
};

describe("saveContainerRuntime action", () => {
  let actions: typeof import("./actions"),
    settings: typeof import("@/settings/settings");
  beforeAll(async () => {
    actions = await import("./actions");
    settings = await import("@/settings/settings");
  });

  it("remembers the chosen runtime", async () => {
    await actions.saveContainerRuntime(form({ runtime: "docker" }));
    expect(settings.settings().getContainerRuntime()).toBe("docker");
  });

  it("ignores a runtime name it does not know", async () => {
    await actions.saveContainerRuntime(form({ runtime: "containerd" }));
    expect(settings.settings().getContainerRuntime()).toBe("docker");
  });
});

describe("startContainerRuntime action", () => {
  it("starts the stopped runtime, waits for it, and saves it as the choice", async () => {
    const actions = await import("./actions"),
      settings = await import("@/settings/settings");
    settings.settings().saveContainerRuntime("podman");

    await actions.startContainerRuntime(form({ runtime: "docker" }));

    expect(fake.starts).toEqual(["docker"]);
    expect(fake.running).toBe(true);
    expect(settings.settings().getContainerRuntime()).toBe("docker");
  });
});
