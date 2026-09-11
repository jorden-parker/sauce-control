import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CRAWL_LIMITS } from "@/crawler/crawl-limits";
import { describe, expect, it } from "vitest";
import { cliRuntimeAdapter } from "@/container-runtime/cli-runtime-adapter";
import { RUNTIME_NAMES } from "@/container-runtime/runtime-status";
import type { CommandRunner } from "@/shell/command-runner";
import { runComparison } from "./run-comparison";

const FIXTURE = join(
    import.meta.dirname,
    "..",
    "instance",
    "fixtures",
    "hello-app"
  ),
  SMOKE_TIMEOUT_MS = 5 * 60 * 1000,
  fixtureGit: CommandRunner = {
    run: (_command, args) => {
      cpSync(FIXTURE, args.at(-1)!, { recursive: true });
      return Promise.resolve({ stdout: "" });
    },
  },
  available = async (name: "docker" | "podman"): Promise<boolean> => {
    const status = await cliRuntimeAdapter.detect(name);
    return status.installed && status.running;
  };

/** Real containers. Skipped when the runtime is absent or stopped. */
describe.each(RUNTIME_NAMES)("real %s Comparison", (runtime) => {
  it(
    "runs both branches on localhost:3000 in their own containers and serves each through the Proxy",
    async ({ skip }) => {
      if (!(await available(runtime))) {
        skip();
      }
      const sessionId = `smoke-${Date.now()}`,
        comparison = await runComparison(
          { git: fixtureGit, runtime: cliRuntimeAdapter },
          {
            baseBranch: "main",
            config: {
              crawl: DEFAULT_CRAWL_LIMITS,
              installCommand: "",
              pages: { added: [], removed: [] },
              port: 3000,
              startCommand: "npm run start",
              useDotEnvLocal: false,
            },
            environment: {},
            organisation: "sauce-labs",
            readiness: { pollIntervalMs: 500, timeoutMs: 60_000 },
            repository: "hello-app",
            runtime,
            sessionId,
            targetBranch: "feature",
            token: "unused",
            workDirectory: mkdtempSync(join(tmpdir(), "smoke-")),
          }
        );
      try {
        const bodies = await Promise.all(
          (["base", "target"] as const).map(async (role) => {
            const response = await fetch(comparison.proxy.urlFor(role));
            return response.text();
          })
        );
        expect(bodies).toEqual([
          "hello from the fixture",
          "hello from the fixture",
        ]);
      } finally {
        await comparison.stop();
      }
      await expect(
        cliRuntimeAdapter.listContainers(
          runtime,
          `sauce-control.session=${sessionId}`
        )
      ).resolves.toEqual([]);
    },
    SMOKE_TIMEOUT_MS
  );
});
