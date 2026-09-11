import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  BuildRequest,
  RunRequest,
  RuntimeAdapter,
} from "@/container-runtime/runtime-adapter";
import type { CommandRunner } from "@/shell/command-runner";
import { runInstance } from "./run-instance";

/** In-memory docker: records builds and runs, answers readiness from `listening`. */
const fakeRuntime = ({
    listening = true,
    running = true,
  }: { listening?: boolean; running?: boolean } = {}) => {
    const builds: BuildRequest[] = [],
      removed: string[][] = [],
      runs: RunRequest[] = [],
      adapter: RuntimeAdapter = {
        buildImage: (_name, request) => {
          builds.push(request);
          return Promise.resolve();
        },
        detect: (name) =>
          Promise.resolve({
            installed: true,
            name,
            running,
            version: "29.7.2",
          }),
        isListening: () => Promise.resolve(listening),
        listContainers: () => Promise.resolve([]),
        removeContainers: (_name, ids) => {
          removed.push(ids);
          return Promise.resolve();
        },
        removeImages: () => Promise.resolve(),
        runContainer: (_name, request) => {
          runs.push(request);
          return Promise.resolve({ containerId: "abc123", hostPort: 49152 });
        },
        start: () => Promise.resolve(),
      };
    return { adapter, builds, removed, runs };
  },
  /** Fake git: "clones" by creating the destination with the given files. */
  fakeGit = (
    files: Record<string, string>
  ): CommandRunner & { calls: number } => {
    const git = {
      calls: 0,
      run: (_command: string, args: string[]) => {
        git.calls += 1;
        const destination = args.at(-1)!;
        mkdirSync(destination, { recursive: true });
        for (const [name, content] of Object.entries(files)) {
          writeFileSync(join(destination, name), content);
        }
        return Promise.resolve({ stdout: "" });
      },
    };
    return git;
  },
  request = () => ({
    branch: "feature/login",
    config: {
      buildCommand: "pnpm install --frozen-lockfile",
      port: 3000,
      startCommand: "pnpm run dev",
      useDotEnvLocal: false,
    },
    environment: { API_URL: "https://api.example.test" },
    organisation: "sauce-labs",
    readiness: { pollIntervalMs: 1, timeoutMs: 20 },
    repository: "web-app",
    runtime: "docker" as const,
    sessionId: "session-1",
    token: "ghp_secret",
    workDirectory: mkdtempSync(join(tmpdir(), "instance-")),
  });

describe("running one Instance", () => {
  it("builds with the Repository's own Dockerfile when it has one and reports the Instance ready", async () => {
    const runtime = fakeRuntime(),
      git = fakeGit({ Dockerfile: "FROM scratch\n" }),
      instance = await runInstance(
        { git, runtime: runtime.adapter },
        request()
      );

    expect(runtime.builds).toEqual([
      {
        context: join(instance.clonePath),
        dockerfile: undefined,
        labels: { "sauce-control.session": "session-1" },
        tag: "sauce-control/web-app-feature-login:session-1",
      },
    ]);
    expect(instance).toMatchObject({
      branch: "feature/login",
      containerId: "abc123",
      hostPort: 49_152,
    });
  });

  it("generates a Dockerfile from the Repository Config when the Repository has none", async () => {
    const runtime = fakeRuntime(),
      git = fakeGit({ "package.json": "{}" });

    await runInstance({ git, runtime: runtime.adapter }, request());

    expect(runtime.builds[0]?.dockerfile).toContain(
      "pnpm install --frozen-lockfile"
    );
    expect(runtime.builds[0]?.dockerfile).toContain(
      'CMD ["sh", "-c", "pnpm run dev"]'
    );
  });

  it("labels the container with the session id and passes the port and environment", async () => {
    const runtime = fakeRuntime(),
      git = fakeGit({ Dockerfile: "FROM scratch\n" });

    await runInstance({ git, runtime: runtime.adapter }, request());

    expect(runtime.runs).toEqual([
      {
        environment: { API_URL: "https://api.example.test" },
        image: "sauce-control/web-app-feature-login:session-1",
        labels: {
          "sauce-control.branch": "feature/login",
          "sauce-control.session": "session-1",
        },
        port: 3000,
      },
    ]);
  });
});

describe("running one Instance when the Container Runtime is stopped", () => {
  it("fails with the fix before cloning anything", async () => {
    const runtime = fakeRuntime({ running: false }),
      git = fakeGit({});

    await expect(
      runInstance({ git, runtime: runtime.adapter }, request())
    ).rejects.toThrow(
      "docker is not running. Start it from Settings and try again."
    );
    expect(git.calls).toBe(0);
  });
});

describe("running one Instance that never listens", () => {
  it("removes the container and reports the timeout", async () => {
    const runtime = fakeRuntime({ listening: false }),
      git = fakeGit({ Dockerfile: "FROM scratch\n" });

    await expect(
      runInstance({ git, runtime: runtime.adapter }, request())
    ).rejects.toThrow("feature/login did not listen on port 3000 within 20ms");
    expect(runtime.removed).toEqual([["abc123"]]);
  });
});
