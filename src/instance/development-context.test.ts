import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CRAWL_LIMITS } from "@/crawler/crawl-limits";
import { prepareDevelopmentContext } from "./development-context";
import type { InstanceRequest } from "./run-instance";

const roots: string[] = [],
  fixture = () => {
    const root = mkdtempSync(join(tmpdir(), "dev-context-")),
      clone = join(root, "clone"),
      checkout = join(root, "web-app");
    roots.push(root);
    mkdirSync(clone);
    mkdirSync(checkout);
    writeFileSync(
      join(clone, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@10.15.0",
        scripts: { develop: "vite" },
      })
    );
    const request: InstanceRequest = {
      branch: "main",
      codeDirectory: root,
      config: {
        crawl: DEFAULT_CRAWL_LIMITS,
        installCommand: "",
        pages: { added: [], removed: [] },
        port: 3000,
        startCommand: "",
      },
      environment: {},
      organisation: "fixture",
      readiness: { pollIntervalMs: 1, timeoutMs: 1 },
      repository: "web-app",
      runtime: "docker",
      sessionId: "test",
      token: "unused",
      workDirectory: root,
    };
    return { checkout, clone, request, root };
  };
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("development context", () => {
  it("excludes environment files, selected arbitrary names, Git credentials and symlinks before image creation", () => {
    const { clone, checkout, request } = fixture();
    for (const path of [".env", ".env.local", "secrets.txt", "Dockerfile"]) {
      writeFileSync(join(clone, path), "private-content");
    }
    writeFileSync(join(checkout, "secrets.txt"), "private-content");
    mkdirSync(join(clone, ".git"));
    writeFileSync(join(clone, ".git", "config"), "private-content");
    symlinkSync(join(checkout, "secrets.txt"), join(clone, "linked-secret"));
    request.environmentFiles = [join(checkout, "secrets.txt")];
    const result = prepareDevelopmentContext(clone, request);
    for (const path of [
      ".env",
      ".env.local",
      "secrets.txt",
      "Dockerfile",
      ".git",
      "linked-secret",
    ]) {
      expect(existsSync(join(result.context, "source", path))).toBe(false);
    }
    expect(readFileSync(join(checkout, "secrets.txt"), "utf8")).toBe(
      "private-content"
    );
    expect(result.development).toEqual({
      installCommand: "pnpm install --frozen-lockfile",
      startCommand: "pnpm run develop",
    });
  });
  it("uses an unambiguous lockfile when packageManager is absent", () => {
    const { clone, request } = fixture();
    writeFileSync(
      join(clone, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } })
    );
    writeFileSync(join(clone, "pnpm-lock.yaml"), "");
    expect(
      prepareDevelopmentContext(clone, request).development.startCommand
    ).toBe("pnpm run dev");
  });
  it("rejects conflicting lockfiles and production installation hooks", () => {
    const { clone, request } = fixture();
    writeFileSync(join(clone, "package-lock.json"), "{}");
    expect(() => prepareDevelopmentContext(clone, request)).toThrow(
      "conflicts"
    );
    rmSync(join(clone, "package-lock.json"));
    writeFileSync(
      join(clone, "package.json"),
      JSON.stringify({ scripts: { dev: "vite", postinstall: "pnpm build" } })
    );
    expect(() => prepareDevelopmentContext(clone, request)).toThrow(
      "Production commands cannot run"
    );
  });
  it("rejects production saved commands even when a dev script exists", () => {
    const { clone, request } = fixture();
    request.config.startCommand = "next start";
    expect(() => prepareDevelopmentContext(clone, request)).toThrow(
      "Production commands cannot run"
    );
  });
});
