import { describe, expect, it } from "vitest";
import {
  type CommandRunner,
  cliRuntimeAdapter,
  createCliRuntimeAdapter,
} from "./cli-runtime-adapter";
import { RUNTIME_NAMES } from "./runtime-status";

/** Fake shell: scripted stdout per "command args", `hang` commands only finish via the timeout option. */
const fakeShell = ({
    hang = [],
    outputs,
  }: {
    hang?: string[];
    outputs: Record<string, string>;
  }): CommandRunner & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      run: (command, args, { timeoutMs }) => {
        const line = [command, ...args].join(" ");
        calls.push(line);
        if (hang.includes(line)) {
          return new Promise((_, reject) => {
            setTimeout(
              () => reject(new Error(`timed out after ${timeoutMs}ms`)),
              timeoutMs
            );
          });
        }
        const stdout = outputs[line];
        return stdout === undefined
          ? Promise.reject(
              Object.assign(new Error(`${command}: not found`), {
                code: "ENOENT",
              })
            )
          : Promise.resolve({ stdout });
      },
    };
  },
  mac = { platform: "darwin" as const };

describe("CLI adapter detection", () => {
  it("treats a docker info that hangs as stopped instead of hanging the page", async () => {
    const shell = fakeShell({
        hang: ["docker info --format {{.ServerVersion}}"],
        outputs: { "docker --version": "Docker version 29.7.2, build a7dcaa6" },
      }),
      adapter = createCliRuntimeAdapter(shell, {
        ...mac,
        commandTimeoutMs: 20,
      });
    await expect(adapter.detect("docker")).resolves.toEqual({
      installed: true,
      name: "docker",
      running: false,
      version: "29.7.2",
    });
  });
});

describe("CLI adapter start", () => {
  it("runs the start command for the active docker context", async () => {
    const shell = fakeShell({
      outputs: { "colima start": "", "docker context show": "colima\n" },
    });
    await createCliRuntimeAdapter(shell, mac).start("docker");
    expect(shell.calls).toContain("colima start");
  });

  it("refuses with the manual hint when nothing can be started automatically", async () => {
    const shell = fakeShell({
      outputs: { "docker context show": "default\n" },
    });
    await expect(
      createCliRuntimeAdapter(shell, { platform: "linux" }).start("docker")
    ).rejects.toThrow(
      "docker cannot be started from here. Run `sudo systemctl start docker` and try again."
    );
  });

  it("names the failed command and the manual hint", async () => {
    const shell = fakeShell({
      outputs: { "docker context show": "desktop-linux\n" },
    });
    await expect(
      createCliRuntimeAdapter(shell, mac).start("docker")
    ).rejects.toThrow(
      "Could not start docker with `open -a Docker`. Open Docker and try again."
    );
  });
});

/** Smoke test against the real CLI. Detection only; starting a VM is not something a unit run should do. */
describe.each(RUNTIME_NAMES)("real %s adapter", (name) => {
  it("reports a version and running state when installed, or absent otherwise", async () => {
    const status = await cliRuntimeAdapter.detect(name);
    expect(status.name).toBe(name);
    if (!status.installed) {
      return;
    }
    expect(status.version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(typeof status.running).toBe("boolean");
  });
});
