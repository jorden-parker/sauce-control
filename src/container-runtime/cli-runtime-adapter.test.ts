import { describe, expect, it } from "vitest";
import { cliRuntimeAdapter } from "./cli-runtime-adapter";
import { RUNTIME_NAMES } from "./runtime-status";

/** Smoke test against the real CLI. Detection only; starting a VM is not something a unit run should do. */
describe.each(RUNTIME_NAMES)("real %s adapter", (name) => {
  it("reports a version and running state when installed, or absent otherwise", async () => {
    const status = await cliRuntimeAdapter.detect(name);
    expect(status.name).toBe(name);
    if (!status.installed) {
      return;
    }
    expect(status.version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(typeof status.running).toBe("boolean");
  });
});
