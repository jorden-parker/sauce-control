import { describe, expect, it } from "vitest";
import {
  inferRepositoryConfig,
  looksLikeProductionServer,
} from "./infer-config";

describe("Repository Config inferred from a package manifest", () => {
  it("prefers the dev script for the start command and reads the package manager and port", () => {
    expect(
      inferRepositoryConfig({
        packageManager: "pnpm@10.15.0",
        scripts: {
          build: "next build",
          dev: "next dev -p 4000",
          start: "next start",
        },
      })
    ).toEqual({
      buildCommand: "pnpm install --frozen-lockfile",
      port: 4000,
      startCommand: "pnpm run dev",
    });
  });

  it("falls back to npm, the start script, and port 3000 when the manifest is bare", () => {
    expect(
      inferRepositoryConfig({ scripts: { start: "node server.js" } })
    ).toEqual({
      buildCommand: "npm install",
      port: 3000,
      startCommand: "npm run start",
    });
  });
});

describe("production server warning", () => {
  it("warns when the start command resolves to a production server through a script alias", () => {
    expect(
      looksLikeProductionServer("pnpm run start", {
        scripts: { start: "next start" },
      })
    ).toBe(true);
  });

  it("stays quiet for a dev server", () => {
    expect(
      looksLikeProductionServer("pnpm run dev", {
        scripts: { dev: "next dev" },
      })
    ).toBe(false);
  });

  it("warns on a raw node command serving a build directory", () => {
    expect(looksLikeProductionServer("node dist/server.js", {})).toBe(true);
  });
});
