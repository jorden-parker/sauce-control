import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RuntimeAdapter } from "./runtime-adapter";
import type { RuntimeName, RuntimeStatus } from "./runtime-status";
import { startPlan } from "./start-command";

/** Runs one command; rejects with `code: "ENOENT"` when the binary is absent and after `timeoutMs` when it hangs. */
export interface CommandRunner {
  run: (
    command: string,
    args: string[],
    options: { timeoutMs: number }
  ) => Promise<{ stdout: string }>;
}

export interface CliAdapterOptions {
  /** Upper bound per CLI call so a wedged daemon cannot hang the page. */
  commandTimeoutMs?: number;
  platform: NodeJS.Platform;
}

const execFileAsync = promisify(execFile),
  DEFAULT_COMMAND_TIMEOUT_MS = 10_000,
  VERSION_PATTERN = /\d+\.\d+\.\d+/u,
  isMissingBinary = (error: unknown): boolean =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT";

/** Real shell: `execFile` with a kill-on-timeout. */
export const nodeCommandRunner: CommandRunner = {
  run: (command, args, { timeoutMs }) =>
    execFileAsync(command, args, { timeout: timeoutMs }),
};

export const createCliRuntimeAdapter = (
  shell: CommandRunner,
  { commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, platform }: CliAdapterOptions
): RuntimeAdapter => {
  const run = (command: string, args: string[]) =>
      shell.run(command, args, { timeoutMs: commandTimeoutMs }),
    installedVersion = async (
      name: RuntimeName
    ): Promise<string | undefined> => {
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

  return {
    detect: async (name): Promise<RuntimeStatus> => {
      const version = await installedVersion(name);
      if (version === undefined) {
        return { installed: false, name };
      }
      return { installed: true, name, running: await isRunning(name), version };
    },
    start: async (name) => {
      const { command, hint } = startPlan(name, {
        dockerContext: await dockerContext(),
        platform,
      });
      if (!command) {
        throw new Error(
          `${name} cannot be started from here. ${hint} and try again.`
        );
      }
      const [executable, args] = command;
      try {
        await run(executable, args);
      } catch (error) {
        throw new Error(
          `Could not start ${name} with \`${[executable, ...args].join(" ")}\`. ${hint} and try again.`,
          { cause: error }
        );
      }
    },
  };
};

/** Real Container Runtime adapter: shells out to `docker` / `podman` only. */
export const cliRuntimeAdapter: RuntimeAdapter = createCliRuntimeAdapter(
  nodeCommandRunner,
  { platform: process.platform }
);
