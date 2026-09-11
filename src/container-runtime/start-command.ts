import type { RuntimeName } from "./runtime-status";

export interface StartEnvironment {
  /** Output of `docker context show`, empty when unknown. */
  dockerContext: string;
  platform: NodeJS.Platform;
}

/** How to start a stopped runtime: a command the tool can run, or only a hint for the reviewer. */
export interface StartPlan {
  command?: [string, string[]];
  hint: string;
}

const MAC_DOCKER_APPS: Record<string, string> = {
    orbstack: "OrbStack",
    "rancher-desktop": "Rancher Desktop",
  },
  dockerPlan = ({ dockerContext, platform }: StartEnvironment): StartPlan => {
    if (dockerContext === "colima") {
      return { command: ["colima", ["start"]], hint: "Run `colima start`" };
    }
    if (platform === "darwin") {
      const app = MAC_DOCKER_APPS[dockerContext] ?? "Docker";
      return { command: ["open", ["-a", app]], hint: `Open ${app}` };
    }
    if (platform === "linux") {
      return { hint: "Run `sudo systemctl start docker`" };
    }
    return { hint: "Start Docker Desktop" };
  },
  podmanPlan = ({ platform }: StartEnvironment): StartPlan =>
    platform === "linux"
      ? {
          hint: "Podman on Linux needs no machine; check `podman info` for the error",
        }
      : {
          command: ["podman", ["machine", "start"]],
          hint: "Run `podman machine start`",
        };

export const startPlan = (
  name: RuntimeName,
  environment: StartEnvironment
): StartPlan =>
  name === "podman" ? podmanPlan(environment) : dockerPlan(environment);
