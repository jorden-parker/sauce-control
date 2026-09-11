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
const fake: Pick<RuntimeAdapter, "detect"> = {
  detect: (name) =>
    Promise.resolve(
      name === "podman"
        ? { installed: true, name, running: true, version: "5.6.0" }
        : { installed: false, name }
    ),
};
vi.mock("@/container-runtime/runtime", () => ({ runtimeAdapter: fake }));
const { runComparison } = vi.hoisted(() => ({
  runComparison: vi.fn(() => new Promise(() => {})),
}));
vi.mock("./run-comparison", () => ({ runComparison }));
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
      writeFileSync(file, "API_URL=https://example.test\n");
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
          environment: withFile ? { API_URL: "https://example.test" } : {},
          repository: "web-app",
        })
      );
    }
  );

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
});
