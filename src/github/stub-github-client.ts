import type { GitHubClient } from "./github-client";

/** Deterministic GitHub used by the Playwright suite (SAUCE_CONTROL_GITHUB=stub). */
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
};
