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
