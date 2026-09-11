import { describe, expect, it } from "vitest";
import { startPlan } from "./start-command";

const mac = (dockerContext = "default") => ({
    dockerContext,
    platform: "darwin" as const,
  }),
  linux = (dockerContext = "default") => ({
    dockerContext,
    platform: "linux" as const,
  }),
  windows = { dockerContext: "default", platform: "win32" as const };

describe("starting podman", () => {
  it("uses podman machine start on macOS and Windows", () => {
    expect(startPlan("podman", mac()).command).toEqual([
      "podman",
      ["machine", "start"],
    ]);
    expect(startPlan("podman", windows).command).toEqual([
      "podman",
      ["machine", "start"],
    ]);
  });

  it("has no machine to start on Linux and says so", () => {
    const plan = startPlan("podman", linux());
    expect(plan.command).toBeUndefined();
    expect(plan.hint).toMatch(/podman info/u);
  });
});

describe("starting docker on macOS", () => {
  it("uses colima start when colima is the active context", () => {
    expect(startPlan("docker", mac("colima")).command).toEqual([
      "colima",
      ["start"],
    ]);
  });

  it("opens OrbStack when it is the active context", () => {
    expect(startPlan("docker", mac("orbstack")).command).toEqual([
      "open",
      ["-a", "OrbStack"],
    ]);
  });

  it("opens Rancher Desktop when it is the active context", () => {
    expect(startPlan("docker", mac("rancher-desktop")).command).toEqual([
      "open",
      ["-a", "Rancher Desktop"],
    ]);
  });

  it("opens Docker Desktop otherwise", () => {
    expect(startPlan("docker", mac("desktop-linux")).command).toEqual([
      "open",
      ["-a", "Docker"],
    ]);
    expect(startPlan("docker", mac()).command).toEqual([
      "open",
      ["-a", "Docker"],
    ]);
  });
});

describe("starting docker elsewhere", () => {
  it("cannot start the Linux daemon without root and gives the sudo command", () => {
    const plan = startPlan("docker", linux());
    expect(plan.command).toBeUndefined();
    expect(plan.hint).toContain("sudo systemctl start docker");
  });

  it("does not try on Windows and points at Docker Desktop", () => {
    const plan = startPlan("docker", windows);
    expect(plan.command).toBeUndefined();
    expect(plan.hint).toMatch(/Docker Desktop/u);
  });
});
