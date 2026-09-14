import { describe, expect, it } from "vitest";
import { buildFailureMessage } from "./build-diagnostics";

const failure = (stderr: string) =>
  Object.assign(new Error("build"), { stderr });

describe("build failure diagnostics", () => {
  it.each([
    "unknown flag: --secret\n",
    "ERROR: BuildKit is enabled but the buildx component is missing or broken.\n",
    "the --mount option requires BuildKit. Refer to https://docs.docker.com/go/buildkit/\n",
  ])("names a runtime without secret support: %s", (stderr) => {
    expect(buildFailureMessage(failure(stderr))).toContain("buildx");
  });
  it("names a missing required secret", () => {
    expect(
      buildFailureMessage(
        failure("failed to solve: secret not found: NODE_AUTH_TOKEN")
      )
    ).toContain("NODE_AUTH_TOKEN did not reach");
  });
  it("maps installer codes to fixed hints without quoting output", () => {
    const message = buildFailureMessage(
      failure(
        "ERR_PNPM_FETCH_401 GET https://registry.example.test/secret-pkg: Unauthorized token=abc"
      )
    );
    expect(message).toContain("ERR_PNPM_FETCH_401");
    expect(message).not.toContain("registry.example.test");
    expect(message).not.toContain("abc");
  });
  it("falls back to the generic message", () => {
    expect(buildFailureMessage(new Error("boom"))).toContain(
      "Could not prepare the development container"
    );
  });
});
