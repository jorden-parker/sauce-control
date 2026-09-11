import { describe, expect, it } from "vitest";
import { startCommand } from "./start-command";

describe("start command for a stopped Container Runtime", () => {
  it("starts podman with podman machine start", () => {
    expect(
      startCommand("podman", { dockerContext: "", platform: "darwin" })
    ).toEqual(["podman", ["machine", "start"]]);
  });

  it("starts Docker through colima when that is the active docker context", () => {
    expect(
      startCommand("docker", { dockerContext: "colima", platform: "darwin" })
    ).toEqual(["colima", ["start"]]);
  });

  it("opens Docker Desktop on macOS otherwise", () => {
    expect(
      startCommand("docker", {
        dockerContext: "desktop-linux",
        platform: "darwin",
      })
    ).toEqual(["open", ["-a", "Docker"]]);
  });

  it("uses systemctl on Linux", () => {
    expect(
      startCommand("docker", { dockerContext: "default", platform: "linux" })
    ).toEqual(["systemctl", ["start", "docker"]]);
  });
});
