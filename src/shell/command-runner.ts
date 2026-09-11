import { execFile } from "node:child_process";

export interface RunOptions {
  cwd?: string;
  /** Extra variables for the child only; the parent environment is inherited underneath. */
  environment?: Record<string, string>;
  /** Written to stdin, then stdin is closed. */
  input?: string;
  timeoutMs: number;
}

/** Runs one command; rejects with `code: "ENOENT"` when the binary is absent and after `timeoutMs` when it hangs. */
export interface CommandRunner {
  run: (
    command: string,
    args: string[],
    options: RunOptions
  ) => Promise<{ stdout: string }>;
}

const MAX_BUFFER = 64 * 1024 * 1024;

/** Real shell: `execFile` with a kill-on-timeout. */
export const nodeCommandRunner: CommandRunner = {
  run: (command, args, { cwd, environment, input, timeoutMs }) =>
    new Promise((resolve, reject) => {
      const child = execFile(
        command,
        args,
        {
          cwd,
          env: { ...process.env, ...environment },
          maxBuffer: MAX_BUFFER,
          timeout: timeoutMs,
        },
        (error, stdout) => {
          if (error) {
            reject(error);
          } else {
            resolve({ stdout });
          }
        }
      );
      child.stdin?.end(input ?? "");
    }),
};
