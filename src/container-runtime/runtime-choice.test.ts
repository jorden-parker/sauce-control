import { describe, expect, it } from "vitest";
import { resolveRuntimeChoice } from "./runtime-choice";
import type { RuntimeStatus } from "./runtime-status";

const installed = (
    name: "docker" | "podman",
    running = true
  ): RuntimeStatus => ({ installed: true, name, running, version: "1.0.0" }),
  missing = (name: "docker" | "podman"): RuntimeStatus => ({
    installed: false,
    name,
  });

describe("Container Runtime choice", () => {
  it("uses the only installed runtime silently when nothing is saved", () => {
    const choice = resolveRuntimeChoice({
      saved: undefined,
      statuses: [installed("docker"), missing("podman")],
    });
    expect(choice).toEqual({ kind: "use", runtime: installed("docker") });
  });
});

describe("Container Runtime choice with both installed", () => {
  it("asks the reviewer to choose, showing each runtime, when nothing is saved", () => {
    const choice = resolveRuntimeChoice({
      saved: undefined,
      statuses: [installed("docker", true), installed("podman", false)],
    });
    expect(choice).toEqual({
      candidates: [installed("docker", true), installed("podman", false)],
      kind: "choose",
    });
  });
});

describe("Container Runtime choice with a saved runtime", () => {
  it("uses the saved runtime without asking when it is still installed", () => {
    const choice = resolveRuntimeChoice({
      saved: "podman",
      statuses: [installed("docker"), installed("podman", false)],
    });
    expect(choice).toEqual({
      kind: "use",
      runtime: installed("podman", false),
    });
  });
});

describe("Container Runtime choice when the saved runtime is gone", () => {
  it("prompts to switch instead of silently using the other runtime", () => {
    const choice = resolveRuntimeChoice({
      saved: "podman",
      statuses: [installed("docker"), missing("podman")],
    });
    expect(choice).toEqual({
      candidates: [installed("docker")],
      kind: "saved-missing",
      saved: "podman",
    });
  });
});

describe("Container Runtime choice with nothing installed", () => {
  it("reports that no runtime is available", () => {
    const choice = resolveRuntimeChoice({
      saved: undefined,
      statuses: [missing("docker"), missing("podman")],
    });
    expect(choice).toEqual({ kind: "none" });
  });
});
