import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { DEVELOPMENT_LAUNCHER } from "./development-launcher";

// Run the actual launcher and a real installer child. Only its container socket
// And working directory are replaced, so the diagnostic loop needs no VM.
async function installationResult(
  script: string,
  environment: Record<string, string>
) {
  const root = mkdtempSync(join(tmpdir(), "launcher-diagnostic-"));
  writeFileSync(join(root, "install.cjs"), script);
  const result = Promise.withResolvers<string>(),
    socket = Object.assign(new EventEmitter(), {
      destroy: () => result.reject(new Error("Socket destroyed")),
      end: (value: string) => result.resolve(value),
      setEncoding: () => {},
      write: () => {},
    });
  try {
    runInNewContext(DEVELOPMENT_LAUNCHER, {
      Buffer,
      process: Object.assign(new EventEmitter(), { exit: () => {} }),
      require: (name: string) => {
        if (name === "node:fs") {
          return { unlinkSync: () => {}, chmodSync: () => {} };
        }
        if (name === "node:net") {
          return {
            createServer: (
              _options: unknown,
              accept: (value: typeof socket) => void
            ) => {
              accept(socket);
              return { listen: () => {}, close: () => {} };
            },
          };
        }
        if (name === "node:child_process") {
          return {
            spawn: (
              command: string,
              args: string[],
              options: Parameters<typeof spawn>[2]
            ) => spawn(command, args, { ...options, cwd: root }),
          };
        }
        throw new Error("Unexpected module");
      },
      setTimeout,
    });
    socket.emit(
      "data",
      JSON.stringify({
        environment,
        installCommand: `${JSON.stringify(process.execPath)} install.cjs`,
      })
    );
    socket.emit("end");
    return await result.promise;
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

describe("installer failure feedback", () => {
  it("keeps a specific cause when a lifecycle wrapper also reports failure", async () => {
    expect(
      await installationResult(
        `console.error('ELIFECYCLE'); console.error('ERR_PNPM_FETCH_401'); process.exitCode=1`,
        { NODE_AUTH_TOKEN: "synthetic-token" }
      )
    ).toBe("installation-failed:ERR_PNPM_FETCH_401:present:1");
  });
  it("reports the error code and token delivery while suppressing raw and encoded credentials", async () => {
    const result = await installationResult(
      `console.log(process.env.NODE_AUTH_TOKEN); console.error(Buffer.from(process.env.NODE_AUTH_TOKEN).toString('base64')); console.error('npm error code E401'); process.exitCode=1;`,
      { NODE_AUTH_TOKEN: "synthetic-private-token" }
    );
    expect(result).toBe("installation-failed:E401:present:1");
  });
  it("handles chunk boundaries and large output without copying output to the protocol", async () => {
    expect(
      await installationResult(
        `process.stdout.write('x'.repeat(100000)); process.stderr.write('npm error code EA'); setTimeout(()=>{process.stderr.write('CCES\\n'); process.exitCode=7},10);`,
        { NODE_AUTH_TOKEN: "" }
      )
    ).toBe("installation-failed:EACCES:empty:7");
  });
  it("reports an unknown failure honestly when no recognised code is printed", async () => {
    expect(
      await installationResult(
        `console.error('arbitrary private details'); process.exitCode=42`,
        {}
      )
    ).toBe("installation-failed:unknown:absent:42");
  });
});
