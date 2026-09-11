import type { GitHubClient } from "./github-client";

/** Deterministic GitHub used by the Playwright suite (SAUCE_CONTROL_GITHUB=stub). */
const MANIFESTS: Record<string, string> = {
  "web-app": JSON.stringify({
    name: "web-app",
    packageManager: "pnpm@10.15.0",
    scripts: { build: "next build", dev: "next dev", start: "next start" },
  }),
};

export const stubGitHubClient: GitHubClient = {
  listBranches: (_organisation, repository) =>
    Promise.resolve(
      repository === "web-app"
        ? ["main", "feature/login", "feature/checkout", "release/2026-09"]
        : ["develop", "main"]
    ),
  listRepositories: () =>
    Promise.resolve([
      { defaultBranch: "develop", name: "docs" },
      { defaultBranch: "main", name: "mobile-app" },
      { defaultBranch: "main", name: "web-app" },
    ]),
  readFile: (_organisation, repository, path) =>
    Promise.resolve(
      path === "package.json"
        ? MANIFESTS[repository]
        : repository === "docs" && path === "openapi.yaml"
          ? "openapi: 3.0.3\ninfo:\n  title: Docs API\n  version: '1'\npaths: {}\n"
          : undefined
    ),
};
