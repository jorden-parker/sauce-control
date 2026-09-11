import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RuntimeAdapter } from "./runtime-adapter";
import type { RuntimeName, RuntimeStatus } from "./runtime-status";

const run = promisify(execFile),
  VERSION_PATTERN = /\d+\.\d+\.\d+/u,
  isMissingBinary = (error: unknown): boolean =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT",
  installedVersion = async (name: RuntimeName): Promise<string | undefined> => {
    try {
      const { stdout } = await run(name, ["--version"]);
      return VERSION_PATTERN.exec(stdout)?.[0] ?? stdout.trim();
    } catch (error) {
      if (isMissingBinary(error)) {
        return undefined;
      }
      throw error;
    }
  },
  /** `info` talks to the daemon or VM, so it only succeeds when the runtime is running. */
  isRunning = async (name: RuntimeName): Promise<boolean> => {
    try {
      await run(name, ["info", "--format", "{{.ServerVersion}}"]);
      return true;
    } catch {
      return false;
    }
  },
  startCommand = (name: RuntimeName): [string, string[]] => {
    if (name === "podman") {
      return ["podman", ["machine", "start"]];
    }
    if (process.platform === "darwin") {
      return ["open", ["-a", "Docker"]];
    }
    return ["systemctl", ["start", "docker"]];
  };

/** Real Container Runtime adapter: shells out to `docker` / `podman` only. */
export const cliRuntimeAdapter: RuntimeAdapter = {
  detect: async (name): Promise<RuntimeStatus> => {
    const version = await installedVersion(name);
    if (version === undefined) {
      return { installed: false, name };
    }
    return { installed: true, name, running: await isRunning(name), version };
  },
  start: async (name) => {
    const [command, args] = startCommand(name);
    await run(command, args);
  },
};
