import { ComparisonStartError } from "./comparison-start-error";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { RuntimeAdapter } from "@/container-runtime/runtime-adapter";
import { DEFAULT_CRAWL_LIMITS } from "@/crawler/crawl-limits";

/** Only podman is installed, and its machine is running. */
const fake: Pick<
  RuntimeAdapter,
  "detect" | "listContainers" | "removeContainers" | "removeImages"
> = {
  detect: (name) =>
    Promise.resolve(
      name === "podman"
        ? { installed: true, name, running: true, version: "5.6.0" }
        : { installed: false, name }
    ),
  listContainers: async () => [],
  removeContainers: async () => {},
  removeImages: async () => {},
};
vi.mock("@/container-runtime/runtime", () => ({ runtimeAdapter: fake }));
const { runComparison, discoverPages, detectAffectedPages } = vi.hoisted(
  () => ({
    detectAffectedPages: vi.fn<
      typeof import("./detect-affected-pages").detectAffectedPages
    >(async () => ({ changedFiles: [], pages: [], unattributed: [] })),
    discoverPages: vi.fn<typeof import("./discover-pages").discoverPages>(
      async () => ({ pageStates: [], pages: [] })
    ),
    runComparison: vi.fn<typeof import("./run-comparison").runComparison>(
      (_deps, request) =>
        new Promise((_resolve, reject) => {
          request.signal?.throwIfAborted();
          request.signal?.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true }
          );
        })
    ),
  })
);
vi.mock("./run-comparison", () => ({ runComparison }));
vi.mock("./discover-pages", () => ({ discoverPages }));
vi.mock("./detect-affected-pages", () => ({ detectAffectedPages }));
vi.mock("@/github/github", () => ({
  gitHubToken: async () => "test-token",
}));
process.env.SAUCE_CONTROL_KEYCHAIN = "memory";

process.env.SAUCE_CONTROL_DATA_DIR = mkdtempSync(
  join(tmpdir(), "sauce-control-current-comparison-")
);

describe("currentComparison", () => {
  let comparison: typeof import("./current-comparison"),
    settings: typeof import("@/settings/settings");
  beforeAll(async () => {
    comparison = await import("./current-comparison");
    settings = await import("@/settings/settings");
  });
  afterEach(async () => {
    await comparison.stopCurrentComparison();
    settings.settings().saveEnvironmentSetupCommand("");
    settings.settings().savePackageRegistry("");
    const store = settings.settings(),
      repository = store.getComparisonSelection()?.repository;
    if (repository) {
      const config = store.getRepositoryConfig(repository);
      if (config?.environmentSetupCommand) {
        store.saveRepositoryConfig(repository, {
          ...config,
          environmentSetupCommand: "",
        });
      }
    }
    runComparison.mockClear();
  });
  afterAll(() => {
    settings.settings().close();
    rmSync(process.env.SAUCE_CONTROL_DATA_DIR!, {
      force: true,
      recursive: true,
    });
  });

  it("uses the only installed runtime without a visit to Settings, and remembers it", async () => {
    expect(settings.settings().getContainerRuntime()).toBeUndefined();
    await expect(comparison.canRunComparison()).resolves.toBe(true);
    expect(settings.settings().getContainerRuntime()).toBe("podman");
  });

  it.each([false, true])(
    "starts without a separate configuration save (Environment File: %s)",
    async (withFile) => {
      const store = settings.settings(),
        file = join(process.env.SAUCE_CONTROL_DATA_DIR!, "test.env");
      writeFileSync(
        file,
        "API_URL=https://example.test\nNODE_AUTH_TOKEN=synthetic-install-token\n"
      );
      store.saveOrganisation("example");
      store.saveComparisonSelection({
        baseBranch: "main",
        repository: "web-app",
        targetBranch: "feature",
      });
      store.saveEnvironmentFiles("web-app", withFile ? [file] : []);

      await comparison.startCurrentComparison();

      expect(comparison.currentComparison()).not.toEqual({
        kind: "failed",
        message: "Configure web-app first.",
      });
      expect(runComparison).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          config: {
            crawl: DEFAULT_CRAWL_LIMITS,
            installCommand: "",
            pages: { added: [], removed: [] },
            port: 3000,
            startCommand: "",
          },
          environment: withFile
            ? {
                API_URL: "https://example.test",
                NODE_AUTH_TOKEN: "synthetic-install-token",
              }
            : {},
          repository: "web-app",
        })
      );
    }
  );

  it("adds the saved package registry as NPM_REGISTRY, below setup exports", async () => {
    const store = settings.settings();
    store.saveOrganisation("example");
    store.saveComparisonSelection({
      baseBranch: "main",
      repository: "web-app",
      targetBranch: "feature",
    });
    store.savePackageRegistry("https://registry.example.test/npm/npm/");
    await comparison.startCurrentComparison();
    expect(runComparison).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        environment: expect.objectContaining({
          NPM_REGISTRY: "https://registry.example.test/npm/npm/",
        }),
      })
    );
  });

  it("uses explicitly saved Repository configuration", async () => {
    const store = settings.settings(),
      config = {
        crawl: DEFAULT_CRAWL_LIMITS,
        installCommand: "pnpm install",
        pages: { added: [], removed: [] },
        port: 4000,
        startCommand: "pnpm run develop",
      };
    store.saveOrganisation("example");
    store.saveComparisonSelection({
      baseBranch: "main",
      repository: "configured-app",
      targetBranch: "feature",
    });
    store.saveRepositoryConfig("configured-app", config);
    await comparison.startCurrentComparison();
    expect(runComparison).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ config })
    );
  });
  it("captures setup once before starting either Instance, overrides files, and refreshes on retry", async () => {
    const store = settings.settings(),
      repository = "setup-app",
      file = join(process.env.SAUCE_CONTROL_DATA_DIR!, "setup.env");
    writeFileSync(file, "API_URL=old\nNODE_AUTH_TOKEN=old\n");
    store.saveComparisonSelection({
      baseBranch: "main",
      repository,
      targetBranch: "feature",
    });
    store.saveEnvironmentFiles(repository, [file]);
    const config = {
      crawl: DEFAULT_CRAWL_LIMITS,
      environmentSetupCommand: "export API_URL=fresh NODE_AUTH_TOKEN=first",
      installCommand: "pnpm install",
      pages: { added: [], removed: [] },
      port: 3000,
      startCommand: "pnpm dev",
    };
    store.saveRepositoryConfig(repository, config);
    store.saveEnvironmentSetupCommand(config.environmentSetupCommand);
    await comparison.startCurrentComparison();
    await vi.waitFor(() => expect(runComparison).toHaveBeenCalledOnce());
    expect(runComparison.mock.calls[0]![1]).toMatchObject({
      environment: { API_URL: "fresh", NODE_AUTH_TOKEN: "first" },
      setupEnvironment: { API_URL: "fresh", NODE_AUTH_TOKEN: "first" },
    });
    expect(
      comparison.currentComparisonSnapshot().progress?.steps
    ).toContainEqual(
      expect.objectContaining({ key: "environment", state: "complete" })
    );
    expect(
      JSON.stringify(comparison.currentComparisonSnapshot())
    ).not.toContain("NODE_AUTH_TOKEN");
    await comparison.stopCurrentComparison();
    store.saveRepositoryConfig(repository, {
      ...config,
      environmentSetupCommand:
        "export API_URL=refreshed NODE_AUTH_TOKEN=second",
    });
    store.saveEnvironmentSetupCommand(
      "export API_URL=refreshed NODE_AUTH_TOKEN=second"
    );
    store.saveComparisonSelection({
      baseBranch: "main",
      repository: "another-setup-app",
      targetBranch: "feature",
    });
    store.saveOrganisation("another-organisation");
    await comparison.startCurrentComparison();
    await vi.waitFor(() => expect(runComparison).toHaveBeenCalledTimes(2));
    expect(runComparison.mock.calls[1]![1].environment).toEqual({
      API_URL: "refreshed",
      NODE_AUTH_TOKEN: "second",
    });
  });

  it("stops before starting Instances when setup fails and reports only a safe exit status", async () => {
    const store = settings.settings(),
      repository = "setup-failure";
    store.saveComparisonSelection({
      baseBranch: "main",
      repository,
      targetBranch: "feature",
    });
    store.saveRepositoryConfig(repository, {
      crawl: DEFAULT_CRAWL_LIMITS,
      environmentSetupCommand: "echo synthetic-private-output >&2; exit 42",
      installCommand: "pnpm install",
      pages: { added: [], removed: [] },
      port: 3000,
      startCommand: "pnpm dev",
    });
    store.saveEnvironmentSetupCommand(
      "echo synthetic-private-output >&2; exit 42"
    );
    await comparison.startCurrentComparison();
    await vi.waitFor(() =>
      expect(comparison.currentComparisonSnapshot()).toMatchObject({
        progress: { cleanup: "complete" },
        status: { kind: "failed", message: expect.stringContaining("exit 42") },
      })
    );
    expect(runComparison).not.toHaveBeenCalled();
    expect(
      JSON.stringify(comparison.currentComparisonSnapshot())
    ).not.toContain("synthetic-private-output");
  });

  it("returns while setup waits and lets cancellation prevent installation", async () => {
    const store = settings.settings(),
      repository = "setup-cancel";
    store.saveComparisonSelection({
      baseBranch: "main",
      repository,
      targetBranch: "feature",
    });
    store.saveRepositoryConfig(repository, {
      crawl: DEFAULT_CRAWL_LIMITS,
      environmentSetupCommand: "sleep 30",
      installCommand: "pnpm install",
      pages: { added: [], removed: [] },
      port: 3000,
      startCommand: "pnpm dev",
    });
    store.saveEnvironmentSetupCommand("sleep 30");
    await comparison.startCurrentComparison();
    expect(
      comparison.currentComparisonSnapshot().progress?.steps
    ).toContainEqual(
      expect.objectContaining({ key: "environment", state: "active" })
    );
    await comparison.stopCurrentComparison();
    expect(comparison.currentComparisonSnapshot()).toMatchObject({
      progress: { cleanup: "complete" },
      status: { kind: "cancelled" },
    });
    expect(runComparison).not.toHaveBeenCalled();
  });

  it.each([
    "docker is not running. Start it from Settings and try again.",
    "Dependency installation failed. Check NODE_AUTH_TOKEN in Environment Files on Compare.",
    "Development server did not listen on port 3000. Check Port in Repository Config.",
  ])("preserves a controlled startup error: %s", async (message) => {
    runComparison.mockRejectedValueOnce(new ComparisonStartError(message));
    await comparison.startCurrentComparison();
    await vi.waitFor(() => {
      expect(comparison.currentComparison()).toEqual({
        kind: "failed",
        message,
      });
    });
  });

  it("blocks direct startup when legacy setup commands conflict", async () => {
    const spy = vi
      .spyOn(settings.settings(), "getEnvironmentSetup")
      .mockReturnValueOnce({
        command: "",
        conflicts: [
          { command: "private-command-one", repository: "one" },
          { command: "private-command-two", repository: "two" },
        ],
        registry: "",
      });
    await comparison.startCurrentComparison();
    expect(runComparison).not.toHaveBeenCalled();
    expect(comparison.currentComparison()).toMatchObject({
      kind: "failed",
      message: expect.stringContaining("Settings"),
    });
    expect(
      JSON.stringify(comparison.currentComparisonSnapshot())
    ).not.toContain("private-command");
    spy.mockRestore();
  });
  it("suppresses arbitrary errors even when they resemble a safe summary", async () => {
    runComparison.mockRejectedValueOnce(
      new Error("Dependency installation failed: secret-token")
    );
    await comparison.startCurrentComparison();
    await vi.waitFor(() => {
      expect(comparison.currentComparison()).toEqual({
        kind: "failed",
        message: expect.stringContaining("Open Compare → Configure repository"),
      });
    });
    expect(JSON.stringify(comparison.currentComparison())).not.toContain(
      "secret-token"
    );
  });
  it("blocks replacement until cancelled work settles and never publishes a late ready result", async () => {
    const pending =
      Promise.withResolvers<import("./run-comparison").RunningComparison>();
    runComparison.mockReturnValueOnce(pending.promise);
    await comparison.startCurrentComparison();
    const id = comparison.currentComparisonSnapshot().progress?.id,
      stopped = comparison.stopCurrentComparison();
    expect(comparison.currentComparison().kind).toBe("cancelled");
    expect(comparison.currentComparisonSnapshot().progress?.cleanup).toBe(
      "pending"
    );
    await comparison.startCurrentComparison();
    expect(runComparison).toHaveBeenCalledTimes(1);
    const running = runningFixture();
    pending.resolve(running);
    await stopped;
    expect(running.stop).toHaveBeenCalledOnce();
    expect(comparison.currentComparisonSnapshot()).toMatchObject({
      progress: { cleanup: "complete", id, outcome: "cancelled" },
      status: { kind: "cancelled" },
    });
    await comparison.startCurrentComparison();
    expect(comparison.currentComparisonSnapshot().progress?.id).not.toBe(id);
  });

  it.each(["discovery", "affected"] as const)(
    "cancels during %s and closes both Instances",
    async (stage) => {
      const running = runningFixture();
      runComparison.mockResolvedValueOnce(running);
      const entered = Promise.withResolvers<void>(),
        waitForAbort = (signal?: AbortSignal) =>
          new Promise<never>((_resolve, reject) => {
            entered.resolve();
            signal?.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          });
      if (stage === "discovery") {
        discoverPages.mockImplementationOnce((_comparison, _config, options) =>
          waitForAbort(options?.signal)
        );
      } else {
        detectAffectedPages.mockImplementationOnce(
          (_git, _comparison, _discovery, options) =>
            waitForAbort(options?.signal)
        );
      }
      await comparison.startCurrentComparison();
      await entered.promise;
      expect(comparison.currentComparison()).toMatchObject({ stage });
      await comparison.stopCurrentComparison();
      expect(running.stop).toHaveBeenCalledOnce();
      expect(comparison.currentComparisonSnapshot().progress).toMatchObject({
        cleanup: "complete",
        outcome: "cancelled",
      });
    }
  );

  it("waits for running Comparison cleanup before allowing another startup", async () => {
    const stopped = Promise.withResolvers<void>(),
      running = runningFixture();
    running.stop = () => stopped.promise;
    runComparison.mockResolvedValueOnce(running);
    await comparison.startCurrentComparison();
    await vi.waitFor(() =>
      expect(comparison.currentComparison().kind).toBe("running")
    );
    const stopping = comparison.stopCurrentComparison();
    await comparison.startCurrentComparison();
    expect(runComparison).toHaveBeenCalledTimes(1);
    expect(comparison.currentComparisonSnapshot().progress?.cleanup).toBe(
      "pending"
    );
    stopped.resolve();
    await stopping;
    expect(comparison.currentComparisonSnapshot().progress?.cleanup).toBe(
      "complete"
    );
    await comparison.startCurrentComparison();
    expect(runComparison).toHaveBeenCalledTimes(2);
  });

  it("publishes a safe failure while cleanup is still pending", async () => {
    const pending =
      Promise.withResolvers<import("./run-comparison").RunningComparison>();
    runComparison.mockImplementationOnce((_deps, request) => {
      request.onFailure?.(
        new ComparisonStartError("Installation failed."),
        "base"
      );
      return pending.promise;
    });
    await comparison.startCurrentComparison();
    expect(comparison.currentComparison()).toEqual({
      kind: "failed",
      message: "Installation failed.",
    });
    expect(comparison.currentComparisonSnapshot().progress?.cleanup).toBe(
      "pending"
    );
    pending.reject(new ComparisonStartError("Installation failed."));
    await vi.waitFor(() =>
      expect(comparison.currentComparisonSnapshot().progress?.cleanup).toBe(
        "complete"
      )
    );
  });
});

function runningFixture(): import("./run-comparison").RunningComparison {
  return {
    base: {
      branch: "main",
      clonePath: "",
      containerId: "base",
      hostPort: 4000,
    },
    detectSchemaSources: async () => [],
    proxy: {
      close: async () => {},
      ports: { base: 4000, target: 4001 },
      setScenario: () => {},
      urlFor: () => "http://localhost:4000/",
    },
    scenarios: () => [],
    stop: vi.fn(async () => {}),
    target: {
      branch: "feature",
      clonePath: "",
      containerId: "target",
      hostPort: 4001,
    },
  };
}
