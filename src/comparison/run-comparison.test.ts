import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CRAWL_LIMITS } from "@/crawler/crawl-limits";
import { describe, expect, it } from "vitest";
import type {
  RunRequest,
  RuntimeAdapter,
} from "@/container-runtime/runtime-adapter";
import type { CommandRunner } from "@/shell/command-runner";
import { runComparison } from "./run-comparison";

/** In-memory docker whose containers only "start" once both branches asked, so a sequential runner would hang. */
const fakeRuntime = ({ failing }: { failing?: string } = {}) => {
    const removed: string[] = [],
      runs: RunRequest[] = [];
    let nextPort = 40_000;
    const { promise: bothAsked, resolve: release } =
        Promise.withResolvers<void>(),
      adapter: RuntimeAdapter = {
        buildImage: () => Promise.resolve(),
        detect: (name) =>
          Promise.resolve({
            installed: true,
            name,
            running: true,
            version: "29.7.2",
          }),
        inspectContainers: () => Promise.resolve([]),
        isListening: (_name, containerId) =>
          containerId === failing
            ? Promise.resolve(false)
            : Promise.resolve(true),
        listContainers: () => Promise.resolve([]),
        removeContainers: (_name, ids) => {
          removed.push(...ids);
          return Promise.resolve();
        },
        removeImages: () => Promise.resolve(),
        runContainer: async (_name, request) => {
          runs.push(request);
          if (runs.length === 2) {
            release();
          }
          await bothAsked;
          nextPort += 1;
          return {
            containerId: request.labels["sauce-control.branch"] ?? "",
            hostPort: nextPort,
          };
        },
        start: () => Promise.resolve(),
        startContainers: () => Promise.resolve(),
        stopContainers: () => Promise.resolve(),
      };
    return { adapter, removed, runs };
  },
  fakeGit: CommandRunner = {
    run: (_command, args) => {
      const destination = args.at(-1)!;
      mkdirSync(destination, { recursive: true });
      writeFileSync(
        join(destination, "package.json"),
        JSON.stringify({
          packageManager: "pnpm@10.15.0",
          scripts: { dev: "node server.js" },
        })
      );
      writeFileSync(join(destination, "Dockerfile"), "FROM scratch\n");
      return Promise.resolve({ stdout: "" });
    },
  },
  request = () => ({
    baseBranch: "main",
    config: {
      crawl: DEFAULT_CRAWL_LIMITS,
      installCommand: "pnpm install",
      pages: { added: [], removed: [] },
      port: 3000,
      startCommand: "pnpm run dev",
      useDotEnvLocal: false,
    },
    environment: {},
    organisation: "sauce-labs",
    readiness: { pollIntervalMs: 1, timeoutMs: 20 },
    repository: "web-app",
    runtime: "docker" as const,
    sessionId: "session-1",
    targetBranch: "feature/login",
    token: "ghp_secret",
    workDirectory: mkdtempSync(join(tmpdir(), "comparison-")),
  });

describe("running a Comparison", () => {
  it("brings up both Instances at once and serves each through the Proxy", async () => {
    const runtime = fakeRuntime(),
      comparison = await runComparison(
        { git: fakeGit, runtime: runtime.adapter },
        request()
      );
    try {
      expect(
        runtime.runs.map((run) => run.labels["sauce-control.branch"])
      ).toEqual(["main", "feature/login"]);
      expect(comparison.base.hostPort).not.toBe(comparison.target.hostPort);
      expect(comparison.proxy.urlFor("base")).toMatch(
        /^http:\/\/127\.0\.0\.1:\d+\/$/u
      );
      expect(comparison.proxy.urlFor("target")).not.toBe(
        comparison.proxy.urlFor("base")
      );
      const response = await fetch(comparison.proxy.urlFor("target"));
      expect(response.status).toBe(502);
    } finally {
      await comparison.stop();
    }
    await expect(fetch(comparison.proxy.urlFor("base"))).rejects.toThrow();
    expect(runtime.removed.toSorted()).toEqual(["feature/login", "main"]);
  });

  it("removes the Instance that did come up when the other fails", async () => {
    const runtime = fakeRuntime({ failing: "feature/login" });
    await expect(
      runComparison({ git: fakeGit, runtime: runtime.adapter }, request())
    ).rejects.toThrow("feature/login did not listen on port 3000");
    expect(runtime.removed.toSorted()).toEqual(["feature/login", "main"]);
  });
});
