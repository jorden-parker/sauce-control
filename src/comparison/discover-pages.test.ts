import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CRAWL_LIMITS } from "@/crawler/crawl-limits";
import type { RepositoryConfig } from "@/settings/settings-store";
import { type Discovery, discoverPages } from "./discover-pages";
import { fixtureDependencies } from "./fixtures/static-app";
import { type RunningComparison, runComparison } from "./run-comparison";

const request = () => ({
    baseBranch: "main",
    config: configWith({}),
    environment: {},
    organisation: "sauce-labs",
    readiness: { pollIntervalMs: 1, timeoutMs: 20 },
    repository: "web-app",
    runtime: "docker" as const,
    sessionId: "session-1",
    targetBranch: "feature/login",
    token: "ghp_secret",
    workDirectory: mkdtempSync(join(tmpdir(), "discovery-")),
  }),
  configWith = (
    overrides: Partial<Pick<RepositoryConfig, "crawl" | "pages">>
  ): RepositoryConfig => ({
    crawl: DEFAULT_CRAWL_LIMITS,
    installCommand: "",
    pages: { added: [], removed: [] },
    port: 3000,
    startCommand: "",
    useDotEnvLocal: false,
    ...overrides,
  }),
  /** Discovers under other limits or manual Pages on a fresh Comparison of the fixture. */
  discoverWith = async (
    overrides: Partial<Pick<RepositoryConfig, "crawl" | "pages">>
  ): Promise<Discovery> => {
    const comparison = await runComparison(fixtureDependencies(), request());
    try {
      return await discoverPages(comparison, configWith(overrides));
    } finally {
      await comparison.stop();
    }
  },
  paths = (discovery: Discovery): string[] =>
    discovery.pages.map((page) => page.path).toSorted();

describe("discovering Pages of the fixture Repository with the default limits", () => {
  let comparison: RunningComparison, discovery: Discovery;

  beforeAll(async () => {
    comparison = await runComparison(fixtureDependencies(), request());
    discovery = await discoverPages(comparison, request().config);
  }, 60_000);

  afterAll(async () => {
    await comparison.stop();
  });

  it("seeds Pages from the sitemap, including ones nothing links to", () => {
    expect(paths(discovery)).toContain("/pricing");
  });

  it("follows same-origin links found in the accessibility tree and ignores external ones", () => {
    expect(paths(discovery)).toContain("/deep/one");
    expect(paths(discovery).every((path) => path.startsWith("/"))).toBe(true);
  });

  it("strips the query so /about?tab=team is the /about Page", () => {
    expect(
      paths(discovery).filter((path) => path.startsWith("/about"))
    ).toEqual(["/about"]);
  });

  it("collapses numeric segments so /users/1, /users/2 and /users/3 are one Page", () => {
    expect(
      paths(discovery).filter((path) => path.startsWith("/users"))
    ).toEqual(["/users/1"]);
  });

  it("records a dialog opened by a button as a Page State with the interaction that reaches it", () => {
    expect(discovery.pageStates).toContainEqual({
      interactions: [{ name: "Open dialog", role: "button" }],
      path: "/",
    });
  });

  it("records a selected tab as a Page State but not the tab already selected", () => {
    const tabs = discovery.pageStates.filter((state) =>
      state.interactions.some((interaction) => interaction.role === "tab")
    );
    expect(tabs).toEqual([
      { interactions: [{ name: "Details", role: "tab" }], path: "/" },
    ]);
  });

  it("reaches menu items through the menu button, as Page States or Pages", () => {
    expect(discovery.pageStates).toContainEqual({
      interactions: [
        { name: "More", role: "button" },
        { name: "Help", role: "menuitem" },
      ],
      path: "/",
    });
    expect(paths(discovery)).toContain("/settings");
  });

  it("does not record closing the dialog as a Page State", () => {
    expect(
      discovery.pageStates.filter((state) =>
        state.interactions.some((interaction) => interaction.name === "Close")
      )
    ).toEqual([]);
  });

  it("includes a Page only the Target Branch links to, so both Instances are crawled", () => {
    expect(paths(discovery)).toContain("/careers");
  });

  it("stops three link hops from a seed", () => {
    expect(paths(discovery).filter((path) => path.startsWith("/deep"))).toEqual(
      ["/deep/one", "/deep/three", "/deep/two"]
    );
  });
});

describe("the reviewer's manual Pages", () => {
  it("adds Pages discovery missed and drops ones it found", async () => {
    const discovery = await discoverWith({
      crawl: { ...DEFAULT_CRAWL_LIMITS, maxDepth: 0 },
      pages: { added: ["/hidden"], removed: ["/pricing"] },
    });
    expect(paths(discovery)).toEqual(["/", "/about", "/hidden"]);
  }, 30_000);
});

describe("crawl limits configured per Repository", () => {
  it("keeps the query when stripping is off, so /about?tab=team is its own Page", async () => {
    const discovery = await discoverWith({
      crawl: { ...DEFAULT_CRAWL_LIMITS, maxDepth: 1, stripQuery: false },
    });
    expect(
      paths(discovery).filter((path) => path.startsWith("/about"))
    ).toEqual(["/about", "/about?tab=team"]);
  }, 30_000);

  it("keeps numeric segments apart when collapsing is off", async () => {
    const discovery = await discoverWith({
      crawl: { ...DEFAULT_CRAWL_LIMITS, collapseNumericSegments: false },
    });
    expect(
      paths(discovery).filter((path) => path.startsWith("/users"))
    ).toEqual(["/users/1", "/users/2", "/users/3"]);
  }, 30_000);

  it("stops at the page limit, seeds first", async () => {
    const discovery = await discoverWith({
      crawl: { ...DEFAULT_CRAWL_LIMITS, pageLimit: 3 },
    });
    expect(paths(discovery)).toEqual(["/", "/about", "/pricing"]);
  }, 30_000);

  it("stops one link hop from a seed at depth one", async () => {
    const discovery = await discoverWith({
      crawl: { ...DEFAULT_CRAWL_LIMITS, maxDepth: 1 },
    });
    expect(paths(discovery).filter((path) => path.startsWith("/deep"))).toEqual(
      ["/deep/one"]
    );
  }, 30_000);
});
