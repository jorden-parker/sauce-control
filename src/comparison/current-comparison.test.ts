import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RuntimeAdapter } from "@/container-runtime/runtime-adapter";

/** Only podman is installed, and its machine is running. */
const fake: Pick<RuntimeAdapter, "detect"> = {
  detect: (name) =>
    Promise.resolve(
      name === "podman"
        ? { installed: true, name, running: true, version: "5.6.0" }
        : { installed: false, name }
    ),
};
vi.mock("@/container-runtime/runtime", () => ({ runtimeAdapter: fake }));

process.env.SAUCE_CONTROL_DATA_DIR = mkdtempSync(
  join(tmpdir(), "sauce-control-current-comparison-")
);

describe("canRunComparison", () => {
  let comparison: typeof import("./current-comparison"),
    settings: typeof import("@/settings/settings");
  beforeAll(async () => {
    comparison = await import("./current-comparison");
    settings = await import("@/settings/settings");
  });

  it("uses the only installed runtime without a visit to Settings, and remembers it", async () => {
    expect(settings.settings().getContainerRuntime()).toBeUndefined();
    await expect(comparison.canRunComparison()).resolves.toBe(true);
    expect(settings.settings().getContainerRuntime()).toBe("podman");
  });
});
