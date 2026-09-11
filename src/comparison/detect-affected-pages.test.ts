import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CRAWL_LIMITS } from "@/crawler/crawl-limits";
import type { RepositoryConfig } from "@/settings/settings-store";
import {
  type AffectedPages,
  detectAffectedPages,
} from "./detect-affected-pages";
import { discoverPages } from "./discover-pages";
import {
  type FixtureOptions,
  fixtureDependencies,
} from "./fixtures/static-app";
import { runComparison } from "./run-comparison";

const config: RepositoryConfig = {
    crawl: { ...DEFAULT_CRAWL_LIMITS, maxDepth: 1 },
    installCommand: "",
    pages: { added: [], removed: [] },
    port: 3000,
    startCommand: "",
    useDotEnvLocal: false,
  },
  /** Runs the fixture Comparison, discovers its Pages, and detects which the Target Branch affects. */
  detectWith = async (
    targetBranch: string,
    options: FixtureOptions = {}
  ): Promise<AffectedPages> => {
    const dependencies = fixtureDependencies(options),
      comparison = await runComparison(dependencies, {
        baseBranch: "main",
        config,
        environment: {},
        organisation: "sauce-labs",
        readiness: { pollIntervalMs: 1, timeoutMs: 20 },
        repository: "web-app",
        runtime: "docker",
        sessionId: "session-1",
        targetBranch,
        token: "ghp_secret",
        workDirectory: mkdtempSync(join(tmpdir(), "affected-")),
      });
    try {
      const discovery = await discoverPages(comparison, config);
      return await detectAffectedPages(dependencies.git, comparison, discovery);
    } finally {
      await comparison.stop();
    }
  },
  paths = (affected: AffectedPages): string[] =>
    affected.pages.map((page) => page.path).toSorted();

describe("detecting the Affected Pages of the fixture Repository", () => {
  it("lists only the Pages that load a module changed on the Target Branch", async () => {
    const affected = await detectWith("feature/login");
    expect(paths(affected)).toEqual(["/about", "/careers"]);
    expect(affected.fallback).toBeUndefined();
  }, 30_000);

  it("names the changed files no Page loads as a module, so nothing is dropped silently", async () => {
    const affected = await detectWith("feature/login");
    expect(affected.changedFiles).toContain("src/about.ts");
    expect(affected.unattributed).toEqual([
      "about.html",
      "assets/about.js",
      "assets/careers.js",
      "assets/careers.js.map",
      "careers.html",
    ]);
  }, 30_000);
});

describe("falling back to every Page, as ADR 0002 requires", () => {
  it("lists every Page with the reason when only a stylesheet changed", async () => {
    const affected = await detectWith("feature/css-only");
    expect(affected.fallback).toBe("non-module-changes");
    expect(paths(affected)).toEqual([
      "/",
      "/about",
      "/deep/one",
      "/pricing",
      "/settings",
      "/users/1",
    ]);
  }, 30_000);

  it("lists every Page with the reason when the build serves no source maps", async () => {
    const affected = await detectWith("feature/login", { sourceMaps: false });
    expect(affected.fallback).toBe("missing-source-maps");
    expect(paths(affected)).toContain("/pricing");
  }, 30_000);
});
