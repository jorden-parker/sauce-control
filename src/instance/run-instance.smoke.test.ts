import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CRAWL_LIMITS } from "@/crawler/crawl-limits";
import { describe, expect, it } from "vitest";
import { cliRuntimeAdapter } from "@/container-runtime/cli-runtime-adapter";
import { RUNTIME_NAMES } from "@/container-runtime/runtime-status";
import type { CommandRunner } from "@/shell/command-runner";
import { runInstance } from "./run-instance";
import { removeAllInstances, removeSessionContainers } from "./session";

const FIXTURE = join(import.meta.dirname, "fixtures", "hello-app"),
  SMOKE_TIMEOUT_MS = 5 * 60 * 1000,
  /** Stands in for GitHub: "clones" by copying the fixture app. */
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
describe.each(RUNTIME_NAMES)("real %s Instance", (runtime) => {
  it(
    "starts the fixture, serves it on the host port, cleans up its session, and sweeps leftovers",
    async ({ skip }) => {
      if (!(await available(runtime))) {
        skip();
      }
      const sessionId = `smoke-${Date.now()}`,
        dependencies = { git: fixtureGit, runtime: cliRuntimeAdapter },
        request = {
          branch: "main",
          config: {
            buildCommand: "",
            crawl: DEFAULT_CRAWL_LIMITS,
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
          token: "unused",
          workDirectory: mkdtempSync(join(tmpdir(), "smoke-")),
        },
        instance = await runInstance(dependencies, request);
      let leftover = "";
      try {
        const response = await fetch(`http://127.0.0.1:${instance.hostPort}/`);
        await expect(response.text()).resolves.toBe("hello from the fixture");
        // A "crashed" earlier session left a container behind.
        leftover = (
          await cliRuntimeAdapter.runContainer(runtime, {
            environment: {},
            image: `sauce-control/hello-app-main:${sessionId}`,
            labels: {
              "sauce-control.app": "sauce-control",
              "sauce-control.session": `${sessionId}-crashed`,
            },
            port: 3000,
          })
        ).containerId;
      } finally {
        await removeSessionContainers(cliRuntimeAdapter, runtime, sessionId);
      }
      await expect(
        cliRuntimeAdapter.listContainers(
          runtime,
          `sauce-control.session=${sessionId}`
        )
      ).resolves.toEqual([]);
      await expect(
        cliRuntimeAdapter.listContainers(
          runtime,
          `sauce-control.session=${sessionId}-crashed`
        )
      ).resolves.toEqual([leftover]);

      await expect(
        removeAllInstances(cliRuntimeAdapter, runtime)
      ).resolves.toBeGreaterThanOrEqual(1);
      await expect(
        cliRuntimeAdapter.listContainers(
          runtime,
          "sauce-control.app=sauce-control"
        )
      ).resolves.toEqual([]);
    },
    SMOKE_TIMEOUT_MS
  );
});
