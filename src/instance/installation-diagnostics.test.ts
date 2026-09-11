import { describe, expect, it } from "vitest";
import { installationFailureMessage } from "./installation-diagnostics";

describe("safe installation diagnostics", () => {
  it("distinguishes registry rejection from a missing token", () => {
    const message = installationFailureMessage(
      "installation-failed:E401:present:1"
    );
    expect(message).toContain("NODE_AUTH_TOKEN reached the installer");
    expect(message).toContain("E401");
    expect(message).toContain(".npmrc");
    expect(message).toContain("exit code 1");
  });
  it("reports empty and absent tokens separately", () => {
    expect(
      installationFailureMessage("installation-failed:unknown:empty:1")
    ).toContain("NODE_AUTH_TOKEN was empty");
    expect(
      installationFailureMessage("installation-failed:unknown:absent:1")
    ).toContain("NODE_AUTH_TOKEN was not supplied");
  });
  it("does not blame credentials for permission or lockfile failures", () => {
    expect(
      installationFailureMessage("installation-failed:EACCES:present:243")
    ).toContain("file permissions");
    expect(
      installationFailureMessage(
        "installation-failed:ERR_PNPM_OUTDATED_LOCKFILE:present:1"
      )
    ).toContain("lockfile");
  });
  it.each([
    "installation-failed:secret-value:present:1",
    "installation-failed:E401:secret-value:1",
    "installation-failed:E401:present:secret-value",
    "installation-failed:E401:present:1\nsecret-value",
    "installation-failed:E401:present:999999",
  ])("rejects arbitrary protocol data: %s", (input) => {
    expect(installationFailureMessage(input)).toBeUndefined();
  });
});
