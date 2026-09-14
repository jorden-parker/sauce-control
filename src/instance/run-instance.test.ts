import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CRAWL_LIMITS } from "@/crawler/crawl-limits";
import { describe, expect, it } from "vitest";
import type {
  BuildRequest,
  RunRequest,
  RuntimeAdapter,
} from "@/container-runtime/runtime-adapter";
import type { CommandRunner } from "@/shell/command-runner";
import { type HostProbe, runInstance } from "./run-instance";

const answered: HostProbe = () =>
    Promise.resolve({ outcome: "answered", status: 200 }),
  hanging: HostProbe = () => Promise.resolve({ outcome: "timeout" }),
  /** In-memory docker: records builds and runs, answers readiness from `listening`. */
  fakeRuntime = ({
    exited,
    listening = true,
    reason,
    running = true,
  }: {
    /** The launcher's exit record; the container then reports as stopped. */
    exited?: string;
    listening?: boolean;
    reason?: string;
    running?: boolean;
  } = {}) => {
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
            ...(reason === undefined ? {} : { reason }),
            running,
            version: "29.7.2",
          }),
        exitRecord: () => Promise.resolve(exited),
        inspectContainers: (_name, ids) =>
          Promise.resolve(
            exited === undefined
              ? []
              : ids.map((containerId) => ({
                  containerId,
                  createdAt: "",
                  hostPort: undefined,
                  labels: {},
                  state: "stopped" as const,
                }))
          ),
        isListening: () => Promise.resolve(listening),
        listContainers: () => Promise.resolve([]),
        probeHttp: () => Promise.resolve({ outcome: "answered", status: 200 }),
        removeContainers: (_name, ids) => {
          removed.push(ids);
          return Promise.resolve();
        },
        removeImages: () => Promise.resolve(),
        runContainer: (_name, request) => {
          runs.push(request);
          return Promise.resolve({ containerId: "abc123", hostPort: 49_152 });
        },
        start: () => Promise.resolve(),
        startContainers: () => Promise.resolve(),
        stopContainers: () => Promise.resolve(),
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
        writeFileSync(
          join(destination, "package.json"),
          JSON.stringify({
            packageManager: "pnpm@10.15.0",
            scripts: { dev: "node server.js" },
          })
        );
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
      crawl: DEFAULT_CRAWL_LIMITS,
      installCommand: "pnpm install --frozen-lockfile",
      pages: { added: [], removed: [] },
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
  it("ignores the Repository Dockerfile and prepares the trusted development launcher", async () => {
    const runtime = fakeRuntime(),
      git = fakeGit({ Dockerfile: "FROM scratch\n" }),
      instance = await runInstance(
        { git, probeHost: answered, runtime: runtime.adapter },
        request()
      );

    expect(runtime.builds).toEqual([
      {
        context: `${instance.clonePath}-development`,
        dockerfile: expect.stringContaining("sauce-control-launcher.cjs"),
        labels: {
          "sauce-control.app": "sauce-control",
          "sauce-control.session": "session-1",
        },
        secrets: [],
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

    await runInstance(
      { git, probeHost: answered, runtime: runtime.adapter },
      request()
    );

    expect(runtime.builds[0]?.dockerfile).not.toContain("pnpm install");
    expect(runtime.builds[0]?.dockerfile).toContain(
      'CMD ["node", "/opt/sauce-control-launcher.cjs"]'
    );
  });

  it("hands NODE_AUTH_TOKEN to the build as a secret mount, never in the context", async () => {
    const runtime = fakeRuntime(),
      git = fakeGit({ "package.json": "{}", "pnpm-lock.yaml": "" });

    await runInstance(
      { git, probeHost: answered, runtime: runtime.adapter },
      {
        ...request(),
        environment: {
          API_URL: "https://api.example.test",
          NODE_AUTH_TOKEN: "synthetic-token",
          NPM_REGISTRY: "https://registry.example.test/npm/npm/",
        },
      }
    );

    expect(runtime.builds[0]?.secrets).toEqual([
      { id: "NODE_AUTH_TOKEN", value: "synthetic-token" },
      { id: "NPM_REGISTRY", value: "https://registry.example.test/npm/npm/" },
    ]);
    expect(runtime.builds[0]?.dockerfile).toContain(
      "--mount=type=secret,id=NODE_AUTH_TOKEN,required=true"
    );
    expect(runtime.builds[0]?.dockerfile).not.toContain("synthetic-token");
    expect(runtime.builds[0]?.dockerfile).not.toContain(
      "registry.example.test"
    );
  });

  it("keeps installation at runtime, without secrets, for Repositories without a pnpm lockfile", async () => {
    const runtime = fakeRuntime(),
      git = fakeGit({ "package.json": "{}" });

    await runInstance(
      { git, probeHost: answered, runtime: runtime.adapter },
      { ...request(), environment: { NODE_AUTH_TOKEN: "synthetic-token" } }
    );

    expect(runtime.builds[0]?.dockerfile).not.toContain("--mount=type=secret");
    expect(runtime.builds[0]?.secrets).toEqual([]);
  });

  it("labels the container with the app, session, Repository, and branch and passes the port and environment", async () => {
    const runtime = fakeRuntime(),
      git = fakeGit({ Dockerfile: "FROM scratch\n" });

    await runInstance(
      { git, probeHost: answered, runtime: runtime.adapter },
      request()
    );

    expect(runtime.runs).toEqual([
      {
        development: {
          installCommand: "pnpm install --frozen-lockfile",
          startCommand: "pnpm run dev",
        },
        environment: { API_URL: "https://api.example.test" },
        image: "sauce-control/web-app-feature-login:session-1",
        labels: {
          "sauce-control.app": "sauce-control",
          "sauce-control.branch": "feature/login",
          "sauce-control.repository": "web-app",
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
      runInstance(
        { git, probeHost: answered, runtime: runtime.adapter },
        request()
      )
    ).rejects.toThrow(
      "docker is not running. Start it from Settings and try again."
    );
    expect(git.calls).toBe(0);
  });

  it("includes why the runtime looked stopped when the adapter knows", async () => {
    const runtime = fakeRuntime({
        reason: "Command timed out after 10000ms.",
        running: false,
      }),
      git = fakeGit({});

    await expect(
      runInstance(
        { git, probeHost: answered, runtime: runtime.adapter },
        request()
      )
    ).rejects.toThrow(
      "docker is not running (`docker info` failed: Command timed out after 10000ms.). Start it from Settings and try again."
    );
  });
});

describe("running one Instance that listens but never answers", () => {
  it("names the hop that hangs while trying, then gives up and removes the container", async () => {
    const runtime = fakeRuntime(),
      git = fakeGit({ Dockerfile: "FROM scratch\n" }),
      details: string[] = [];
    runtime.adapter.probeHttp = () => Promise.resolve({ outcome: "timeout" });

    await expect(
      runInstance(
        { git, probeHost: hanging, runtime: runtime.adapter },
        {
          ...request(),
          onDetail: (step, text) => details.push(`${step}: ${text}`),
          readiness: { pollIntervalMs: 1, timeoutMs: 30 },
        }
      )
    ).rejects.toThrow(
      /feature\/login listens on port 3000 but never responds\. GET \/ on 127\.0\.0\.1:49152 \(host\) accepted the connection but sent nothing for 15s; GET \/ on port 3000 inside the container accepted the connection but sent nothing for 15s\. The development server hangs .* Gave up after 30ms\./u
    );
    expect(details[0]).toMatch(
      /^response: feature\/login listens on port 3000 but never responds\. .* Still trying\.$/u
    );
    expect(runtime.removed).toEqual([["abc123"]]);
  });

  it("blames the bridge when the application answers inside its container", async () => {
    const runtime = fakeRuntime(),
      git = fakeGit({ Dockerfile: "FROM scratch\n" });

    await expect(
      runInstance(
        {
          git,
          probeHost: () => Promise.resolve({ outcome: "refused" }),
          runtime: runtime.adapter,
        },
        { ...request(), readiness: { pollIntervalMs: 1, timeoutMs: 1 } }
      )
    ).rejects.toThrow(
      "feature/login works inside its container but not through the published port 45173. GET / on 127.0.0.1:49152 (host) refused the connection; GET / on port 3000 inside the container answered HTTP 200. The bridge is not relaying"
    );
  });
});

describe("running one Instance whose development server exits", () => {
  it("fails at once with the exit status, the hint, and where to see the output", async () => {
    const runtime = fakeRuntime({ exited: "7:EADDRINUSE", listening: false }),
      git = fakeGit({ Dockerfile: "FROM scratch\n" });

    await expect(
      runInstance(
        { git, probeHost: answered, runtime: runtime.adapter },
        request()
      )
    ).rejects.toThrow(
      /^feature\/login: The development server exited with code 7\. It reported EADDRINUSE\. .* Its output is not kept, to protect credentials: run `pnpm run dev` in .*feature-login to see it\.$/u
    );
    expect(runtime.removed).toEqual([["abc123"]]);
  });

  it("does not trust an unrecognised record, and still says where to look", async () => {
    const runtime = fakeRuntime({ exited: "1:rm -rf /", listening: false }),
      git = fakeGit({ Dockerfile: "FROM scratch\n" });

    await expect(
      runInstance(
        { git, probeHost: answered, runtime: runtime.adapter },
        request()
      )
    ).rejects.toThrow(
      /^feature\/login: The development server exited\. Its output is not kept/u
    );
  });
});

describe("running one Instance that never listens", () => {
  it("removes the container and reports the timeout", async () => {
    const runtime = fakeRuntime({ listening: false }),
      git = fakeGit({ Dockerfile: "FROM scratch\n" });

    await expect(
      runInstance(
        { git, probeHost: answered, runtime: runtime.adapter },
        request()
      )
    ).rejects.toThrow("feature/login did not listen on port 3000 within 20ms");
    expect(runtime.removed).toEqual([["abc123"]]);
  });
});
