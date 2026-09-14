import { describe, expect, it } from "vitest";
import {
  developmentExitMessage,
  installationFailureMessage,
} from "./installation-diagnostics";

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

describe("developmentExitMessage", () => {
  it("names the status and hint for a recognised code", () => {
    expect(developmentExitMessage("7:EADDRINUSE")).toMatch(
      /^The development server exited with code 7\. It reported EADDRINUSE\. Something inside the container already uses the port\./u
    );
    expect(developmentExitMessage("127:unknown")).toMatch(
      /could not find the command/u
    );
    expect(developmentExitMessage("signal:unknown")).toMatch(
      /terminated by a signal/u
    );
  });
  it("rejects anything outside the record grammar", () => {
    for (const record of [
      "1:rm -rf /",
      "999:unknown",
      "0:EADDRINUSE\nmore",
      "EADDRINUSE",
    ]) {
      expect(developmentExitMessage(record)).toBeUndefined();
    }
  });
});
