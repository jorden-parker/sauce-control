import type { RuntimeName } from "./runtime-status";

export interface StartEnvironment {
  /** Output of `docker context show`, empty when unknown. */
  dockerContext: string;
  platform: NodeJS.Platform;
}

/** Command that starts a runtime's daemon or VM. Docker on macOS may be Colima or Docker Desktop. */
export const startCommand = (
  name: RuntimeName,
  { dockerContext, platform }: StartEnvironment
): [string, string[]] => {
  if (name === "podman") {
    return ["podman", ["machine", "start"]];
  }
  if (dockerContext === "colima") {
    return ["colima", ["start"]];
  }
  if (platform === "darwin") {
    return ["open", ["-a", "Docker"]];
  }
  return ["systemctl", ["start", "docker"]];
};
