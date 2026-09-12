import { spawn } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { basename } from "node:path";
import type { Readable } from "node:stream";
import { MAX_ENVIRONMENT_BYTES } from "./environment-files";

/** Only fixed summaries cross the boundary from host execution to the UI. */
export class EnvironmentSetupError extends Error {}

const reserved = new Set([
    "PATH",
    "HOME",
    "PORT",
    "NODE_ENV",
    "NODE_OPTIONS",
    "NODE_PATH",
    "SHELL",
    "PWD",
    "OLDPWD",
    "SHLVL",
    "_",
    "BASH_ENV",
    "ENV",
    "ZDOTDIR",
  ]),
  isApplicationVariable = (key: string) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) &&
    !reserved.has(key) &&
    !/^(?:LD_|DYLD_|BASH_FUNC_|sauce_control_setup_)/u.test(key),
  quote = (value: string) => `'${value.replaceAll("'", String.raw`'\''`)}'`,
  capture = `/usr/bin/env -u NODE_OPTIONS -u NODE_PATH ${quote(process.execPath)} -e ${quote(
    String.raw`require("node:fs").writeFileSync(3, JSON.stringify(process.env) + "\n")`
  )}`;

export interface EnvironmentSetupOptions {
  signal?: AbortSignal;
  /** Test seams; production uses the account's login shell and home directory. */
  shell?: string;
  directory?: string;
  environment?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/** Run once on the host; stdout/stderr are discarded, exports use a private pipe. */
export const runEnvironmentSetup = async (
  command: string | undefined,
  options: EnvironmentSetupOptions = {}
): Promise<Record<string, string>> => {
  if (!command?.trim()) {
    return {};
  }
  options.signal?.throwIfAborted();
  if (command.includes("\0") || command.length > 65_536) {
    throw new EnvironmentSetupError(
      "Environment setup command is invalid or too long. Update Environment setup in Settings."
    );
  }
  const shell =
      options.shell ?? userInfo().shell ?? process.env.SHELL ?? "/bin/sh",
    fish = basename(shell) === "fish";
  if (!fish && !/^(?:ba|z)?sh$/u.test(basename(shell))) {
    throw new EnvironmentSetupError(
      "Environment setup requires a sh, bash, zsh or fish login shell."
    );
  }
  return new Promise((resolve, reject) => {
    let baseline: Record<string, string> | undefined,
      failure: Error | undefined,
      killTimer: ReturnType<typeof setTimeout> | undefined,
      result: Record<string, string> | undefined,
      size = 0,
      text = "";
    // Script text travels over stdin, never through process arguments or a file.
    const child = spawn(shell, fish ? ["-l"] : ["-l", "-s"], {
        cwd: options.directory ?? homedir(),
        detached: true,
        env: options.environment ?? process.env,
        stdio: ["pipe", "ignore", "ignore", "pipe"],
      }),
      killGroup = (signal: NodeJS.Signals) => {
        if (child.pid) {
          try {
            process.kill(-child.pid, signal);
          } catch {
            /* Already exited. */
          }
        }
      },
      stop = (error: Error) => {
        if (failure) {
          return;
        }
        failure = error;
        killGroup("SIGTERM");
        killTimer = setTimeout(() => killGroup("SIGKILL"), 250);
      },
      aborted = () =>
        stop(new EnvironmentSetupError("Environment setup cancelled.")),
      timer = setTimeout(
        () =>
          stop(
            new EnvironmentSetupError(
              "Environment setup timed out. Complete browser login and retry the Comparison. Terminal prompts are not supported."
            )
          ),
        options.timeoutMs ?? 5 * 60 * 1000
      );
    options.signal?.addEventListener("abort", aborted, { once: true });
    if (options.signal?.aborted) {
      aborted();
    }
    const pipe = child.stdio[3] as Readable;
    pipe.setEncoding("utf8");
    pipe.on("data", (chunk: string) => {
      if (failure) {
        return;
      }
      size += Buffer.byteLength(chunk);
      if (size > 10 * MAX_ENVIRONMENT_BYTES) {
        stop(
          new EnvironmentSetupError(
            "Environment setup exports exceed the size limit."
          )
        );
        return;
      }
      text += chunk;
      let newline: number;
      while ((newline = text.indexOf("\n")) >= 0) {
        const line = text.slice(0, newline);
        text = text.slice(newline + 1);
        try {
          const parsed: unknown = JSON.parse(line);
          if (
            !parsed ||
            typeof parsed !== "object" ||
            Array.isArray(parsed) ||
            !Object.values(parsed).every(
              (value) => typeof value === "string" && !value.includes("\0")
            )
          ) {
            throw new Error();
          }
          const values = parsed as Record<string, string>;
          if (!baseline) {
            baseline = values;
          } else if (result) {
            throw new Error();
          } else {
            result = Object.fromEntries(
              Object.entries(values).filter(
                ([key, value]) =>
                  isApplicationVariable(key) && baseline![key] !== value
              )
            );
          }
        } catch {
          stop(
            new EnvironmentSetupError(
              "Could not capture environment setup exports. Check the command and retry."
            )
          );
          return;
        }
      }
    });
    pipe.on("error", () =>
      stop(
        new EnvironmentSetupError(
          "Could not capture environment setup exports."
        )
      )
    );
    child.stdin!.on("error", () => {
      /* Close reports early exits without exposing script text. */
    });
    child.on("error", () =>
      stop(
        new EnvironmentSetupError(
          "Could not start environment setup. Check your login shell and Environment setup in Settings."
        )
      )
    );
    // Descendants must not hold the capture pipe open after the shell exits.
    child.on("exit", () => killGroup("SIGKILL"));
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", aborted);
      killGroup("SIGKILL");
      baseline = undefined;
      text = "";
      if (failure) {
        reject(failure);
      } else if (code !== 0) {
        reject(
          new EnvironmentSetupError(
            `Environment setup failed${code === null ? "" : ` (exit ${code})`}. Check the command and browser login, then retry the Comparison. Raw output is suppressed to protect credentials.`
          )
        );
      } else if (result) {
        resolve(result);
      } else {
        reject(
          new EnvironmentSetupError(
            "Environment setup ended before exports could be captured. Remove early exit commands and retry."
          )
        );
      }
      result = undefined;
    });
    child.stdin!.end(
      fish
        ? `${capture}\nor exit $status\nbegin\n${command}\nend </dev/null\nor exit $status\n${capture}\n`
        : `set -e\n${capture}\n{\n${command}\n} </dev/null\nsauce_control_setup_status=$?\n[ "$sauce_control_setup_status" -eq 0 ] || exit "$sauce_control_setup_status"\n${capture}\n`
    );
  });
};
