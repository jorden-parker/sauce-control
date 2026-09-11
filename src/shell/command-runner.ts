import { type ChildProcess, spawn } from "node:child_process";

export interface RunOptions {
  signal?: AbortSignal;
  /** Only use for trusted protocol output; never forward child logs to the UI. */
  onStdout?: (chunk: string) => void;
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

const MAX_BUFFER = 64 * 1024 * 1024,
  /** Every child still running, so exit cleanup can kill a half-finished clone or build. */
  liveChildren = new Set<ChildProcess>(),
  kill = (child: ChildProcess): void => {
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* Already exited. */
      }
    } else {
      child.kill("SIGKILL");
    }
  };

/** Buffers command results while optionally delivering a trusted stdout protocol live. */
export const nodeCommandRunner: CommandRunner = {
  run: (
    command,
    args,
    { cwd, environment, input, timeoutMs, signal, onStdout }
  ) =>
    new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const child = spawn(command, args, {
        cwd,
        detached: process.platform !== "win32",
        env: { ...process.env, ...environment },
        stdio: "pipe",
      });
      let bytes = 0,
        stderr = "",
        stdout = "";
      let failure: Error | undefined;
      const abort = () => {
          kill(child);
        },
        timer = setTimeout(() => {
          failure = new Error(`Command timed out after ${timeoutMs}ms.`);
          kill(child);
        }, timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      const receive = (chunk: string, output: "stdout" | "stderr") => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_BUFFER) {
          failure = new Error("Command output exceeded the buffer limit.");
          kill(child);
          return;
        }
        if (output === "stdout") {
          stdout += chunk;
          onStdout?.(chunk);
        } else {
          stderr += chunk;
        }
      };
      child.stdout.on("data", (chunk: string) => receive(chunk, "stdout"));
      child.stderr.on("data", (chunk: string) => receive(chunk, "stderr"));
      child.once("error", (error) => {
        failure = error;
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        liveChildren.delete(child);
        if (signal?.aborted) {
          reject(signal.reason);
        } else if (failure || code !== 0) {
          reject(
            Object.assign(failure ?? new Error(`Command failed: ${command}`), {
              stdout,
              stderr,
              ...(failure ? {} : { code }),
            })
          );
        } else {
          resolve({ stdout });
        }
      });
      liveChildren.add(child);
      child.stdin.on("error", () => {
        /* An exiting command can close stdin before consuming it. */
      });
      child.stdin.end(input ?? "");
      if (signal?.aborted) {
        abort();
      }
    }),
};

/** Kills every command still running and returns how many there were. */
export const killLiveCommands = (): number => {
  const count = liveChildren.size;
  for (const child of liveChildren) {
    kill(child);
  }
  liveChildren.clear();
  return count;
};
