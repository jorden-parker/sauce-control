import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runEnvironmentSetup } from "./environment-setup";

const roots: string[] = [],
  fixture = () => {
    const directory = mkdtempSync(join(tmpdir(), "environment-setup-"));
    roots.push(directory);
    return {
      directory,
      environment: {
        HOME: directory,
        NODE_ENV: "test" as const,
        PATH: process.env.PATH,
      },
      shell: "/bin/bash",
    };
  };
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("host environment setup", () => {
  it("sources in the same shell and captures only changed application exports, without exposing stdout", async () => {
    const options = fixture();
    writeFileSync(
      join(options.directory, "token.env"),
      "export NODE_AUTH_TOKEN='synthetic-token'\nexport API_URL='https://fresh.test'\nexport MULTILINE='one\ntwo'\nLOCAL_ONLY=no\n"
    );
    const result = await runEnvironmentSetup(
      "echo synthetic-secret-output; echo synthetic-error-output >&2; source ./token.env; export EMPTY=''; export PATH=/invalid; export PORT=9876; export HOME=/invalid; export NODE_OPTIONS='--invalid-option'",
      {
        ...options,
        environment: {
          ...options.environment,
          API_URL: "old",
          INHERITED_SECRET: "not-forwarded",
        },
      }
    );
    expect(result).toEqual({
      API_URL: "https://fresh.test",
      EMPTY: "",
      MULTILINE: "one\ntwo",
      NODE_AUTH_TOKEN: "synthetic-token",
    });
    expect(process.env.NODE_AUTH_TOKEN).not.toBe("synthetic-token");
  });
  it("takes its baseline after login startup and supports zsh source", async () => {
    if (!existsSync("/bin/zsh")) {
      return;
    }
    const options = fixture();
    writeFileSync(
      join(options.directory, ".zprofile"),
      "export LOGIN_ONLY=hidden\n"
    );
    writeFileSync(
      join(options.directory, "token.env"),
      "export NODE_AUTH_TOKEN=fresh\n"
    );
    expect(
      await runEnvironmentSetup("source ~/token.env", {
        ...options,
        shell: "/bin/zsh",
      })
    ).toEqual({ NODE_AUTH_TOKEN: "fresh" });
  });
  it.each([
    "false && export TOKEN=bad",
    "echo synthetic-private-error >&2; exit 42",
    "false\nexport TOKEN=bad",
  ])("fails safely for %s", async (command) => {
    await expect(runEnvironmentSetup(command, fixture())).rejects.toThrow(
      /Environment setup failed/
    );
  });
  it("does not mistake early successful exit for a captured environment", async () => {
    await expect(runEnvironmentSetup("exit 0", fixture())).rejects.toThrow(
      "before exports could be captured"
    );
  });
  it("sources exports and propagates failed chains in fish", async () => {
    const shell = "/opt/homebrew/bin/fish";
    if (!existsSync(shell)) {
      return;
    }
    const options = { ...fixture(), shell };
    writeFileSync(
      join(options.directory, "token.env"),
      "export NODE_AUTH_TOKEN=fish-token\n"
    );
    expect(await runEnvironmentSetup("source ~/token.env", options)).toEqual({
      NODE_AUTH_TOKEN: "fish-token",
    });
    await expect(
      runEnvironmentSetup("false && export TOKEN=bad", options)
    ).rejects.toThrow("Environment setup failed");
  });
  it("does not let a terminal read consume the wrapper script", async () => {
    await expect(runEnvironmentSetup("read answer", fixture())).rejects.toThrow(
      "Environment setup failed"
    );
  });
  it("skips an empty command and safely reports an unavailable shell", async () => {
    expect(await runEnvironmentSetup("  ", { shell: "/missing/bash" })).toEqual(
      {}
    );
    await expect(
      runEnvironmentSetup("true", { shell: "/missing/bash" })
    ).rejects.toThrow("Could not start environment setup");
  });
  it("stops waiting commands on timeout", async () => {
    await expect(
      runEnvironmentSetup("sleep 30", { ...fixture(), timeoutMs: 150 })
    ).rejects.toThrow("timed out");
  });
  it("cancels the process group, including a child ignoring SIGTERM", async () => {
    const options = fixture(),
      controller = new AbortController(),
      pidFile = join(options.directory, "pid"),
      pending = runEnvironmentSetup(
        "sh -c 'trap \"\" TERM; echo $$ > pid; exec sleep 30' & wait",
        { ...options, signal: controller.signal }
      ),
      assertion = expect(pending).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true));
    const pid = Number(readFileSync(pidFile, "utf8"));
    controller.abort();
    await assertion;
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
  });
});
