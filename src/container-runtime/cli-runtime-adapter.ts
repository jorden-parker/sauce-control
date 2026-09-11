import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RuntimeAdapter } from "./runtime-adapter";
import type { RuntimeName, RuntimeStatus } from "./runtime-status";
import { startCommand } from "./start-command";
import { MANUAL_START_HINT } from "./start-runtime";

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
  /** Active docker context, e.g. `colima` or `desktop-linux`; empty when unknown. */
  dockerContext = async (): Promise<string> => {
    try {
      const { stdout } = await run("docker", ["context", "show"]);
      return stdout.trim();
    } catch {
      return "";
    }
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
    const [command, args] = startCommand(name, {
      dockerContext: await dockerContext(),
      platform: process.platform,
    });
    try {
      await run(command, args);
    } catch (error) {
      throw new Error(
        `Could not start ${name} with \`${[command, ...args].join(" ")}\`. ${MANUAL_START_HINT[name]} and try again.`,
        { cause: error }
      );
    }
  },
};
