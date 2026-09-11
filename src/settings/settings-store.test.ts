import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openSettingsStore } from "./settings-store";

const freshDatabasePath = (): string =>
  join(mkdtempSync(join(tmpdir(), "sauce-control-")), "settings.db");

describe("settings store", () => {
  it("has no Organisation before one is saved", () => {
    const store = openSettingsStore(freshDatabasePath());
    expect(store.getOrganisation()).toBeUndefined();
  });

  it("returns the saved Organisation after reopening the same file", () => {
    const path = freshDatabasePath(),
      first = openSettingsStore(path);
    first.saveOrganisation("sauce-labs");
    first.close();

    const second = openSettingsStore(path);
    expect(second.getOrganisation()).toBe("sauce-labs");
  });
});

describe("settings store Container Runtime", () => {
  it("has no Container Runtime before one is saved", () => {
    const store = openSettingsStore(freshDatabasePath());
    expect(store.getContainerRuntime()).toBeUndefined();
  });

  it("returns the saved Container Runtime after reopening the same file", () => {
    const path = freshDatabasePath(),
      first = openSettingsStore(path);
    first.saveContainerRuntime("podman");
    first.close();

    const second = openSettingsStore(path);
    expect(second.getContainerRuntime()).toBe("podman");
  });
});

describe("settings store Comparison selection", () => {
  it("has no selection before one is saved", () => {
    const store = openSettingsStore(freshDatabasePath());
    expect(store.getComparisonSelection()).toBeUndefined();
  });

  it("returns the saved selection after reopening the same file", () => {
    const path = freshDatabasePath(),
      first = openSettingsStore(path);
    first.saveComparisonSelection({
      baseBranch: "release/2026-09",
      repository: "web-app",
      targetBranch: "feature/login",
    });
    first.close();

    const second = openSettingsStore(path);
    expect(second.getComparisonSelection()).toEqual({
      baseBranch: "release/2026-09",
      repository: "web-app",
      targetBranch: "feature/login",
    });
  });
});

describe("settings store Repository Config", () => {
  it("has no config for a Repository before one is saved", () => {
    const store = openSettingsStore(freshDatabasePath());
    expect(store.getRepositoryConfig("web-app")).toBeUndefined();
  });

  it("returns the saved config for that Repository only, after reopening", () => {
    const path = freshDatabasePath(),
      first = openSettingsStore(path);
    first.saveRepositoryConfig("web-app", {
      crawl: {
        collapseNumericSegments: false,
        maxDepth: 2,
        pageLimit: 10,
        stripQuery: false,
      },
      installCommand: "pnpm install --frozen-lockfile",
      pages: { added: ["/hidden"], removed: ["/legal"] },
      port: 4000,
      startCommand: "pnpm run dev",
      useDotEnvLocal: true,
    });
    first.close();

    const second = openSettingsStore(path);
    expect(second.getRepositoryConfig("web-app")).toEqual({
      crawl: {
        collapseNumericSegments: false,
        maxDepth: 2,
        pageLimit: 10,
        stripQuery: false,
      },
      installCommand: "pnpm install --frozen-lockfile",
      pages: { added: ["/hidden"], removed: ["/legal"] },
      port: 4000,
      startCommand: "pnpm run dev",
      useDotEnvLocal: true,
    });
    expect(second.getRepositoryConfig("docs")).toBeUndefined();
  });

  it("gives a config saved before crawl limits and manual Pages existed the defaults", () => {
    const path = freshDatabasePath(),
      store = openSettingsStore(path);
    store.saveRepositoryConfig("web-app", {
      installCommand: "npm install",
      port: 3000,
      startCommand: "npm run dev",
      useDotEnvLocal: false,
    } as never);
    expect(store.getRepositoryConfig("web-app")).toMatchObject({
      crawl: {
        collapseNumericSegments: true,
        maxDepth: 3,
        pageLimit: 50,
        stripQuery: true,
      },
      pages: { added: [], removed: [] },
      port: 3000,
    });
  });
});

describe("settings store Code Directory", () => {
  it("returns the saved Code Directory after reopening the same file", () => {
    const path = freshDatabasePath(),
      first = openSettingsStore(path);
    expect(first.getCodeDirectory()).toBeUndefined();
    first.saveCodeDirectory("/Users/reviewer/src");
    first.close();

    expect(openSettingsStore(path).getCodeDirectory()).toBe(
      "/Users/reviewer/src"
    );
  });
});
