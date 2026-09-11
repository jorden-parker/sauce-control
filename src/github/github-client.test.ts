import { describe, expect, it } from "vitest";
import { type FetchLike, createGitHubClient } from "./github-client";

interface Route {
  body: unknown;
  headers?: Record<string, string>;
  status?: number;
}

/** Fake GitHub REST API keyed by full URL; records each request's headers. */
const fakeGitHub = (routes: Record<string, Route>) => {
  const requests: { headers: Headers; url: string }[] = [],
    fetch: FetchLike = (url, init) => {
      const headers = new Headers(init?.headers);
      requests.push({ headers, url: String(url) });
      const route = routes[String(url)];
      if (route === undefined) {
        return Promise.resolve(new Response("Not Found", { status: 404 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(route.body), {
          headers: { "content-type": "application/json", ...route.headers },
          status: route.status ?? 200,
        })
      );
    };
  return { fetch, requests };
};

describe("GitHub client repositories", () => {
  it("lists the Organisation's repositories with their default branch", async () => {
    const github = fakeGitHub({
        "https://api.github.com/orgs/sauce-labs/repos?per_page=100&sort=full_name":
          {
            body: [
              { default_branch: "main", name: "web-app" },
              { default_branch: "develop", name: "docs" },
            ],
          },
      }),
      client = createGitHubClient(github.fetch, "ghp_abc123");
    await expect(client.listRepositories("sauce-labs")).resolves.toEqual([
      { defaultBranch: "main", name: "web-app" },
      { defaultBranch: "develop", name: "docs" },
    ]);
  });

  it("sends the token as a bearer credential", async () => {
    const github = fakeGitHub({
      "https://api.github.com/orgs/sauce-labs/repos?per_page=100&sort=full_name":
        { body: [] },
    });
    await createGitHubClient(github.fetch, "ghp_abc123").listRepositories(
      "sauce-labs"
    );
    expect(github.requests[0]?.headers.get("authorization")).toBe(
      "Bearer ghp_abc123"
    );
  });
});

describe("GitHub client large Organisations", () => {
  it("follows the Link header to collect every page", async () => {
    const first =
        "https://api.github.com/orgs/sauce-labs/repos?per_page=100&sort=full_name",
      second =
        "https://api.github.com/orgs/sauce-labs/repos?per_page=100&sort=full_name&page=2",
      github = fakeGitHub({
        [first]: {
          body: [{ default_branch: "main", name: "alpha" }],
          headers: { link: `<${second}>; rel="next", <${second}>; rel="last"` },
        },
        [second]: {
          body: [{ default_branch: "main", name: "beta" }],
          headers: { link: `<${first}>; rel="prev", <${first}>; rel="first"` },
        },
      }),
      names = (
        await createGitHubClient(github.fetch, "t").listRepositories(
          "sauce-labs"
        )
      ).map((repository) => repository.name);
    expect(names).toEqual(["alpha", "beta"]);
  });
});

describe("GitHub client branches", () => {
  it("lists a Repository's branch names", async () => {
    const github = fakeGitHub({
      "https://api.github.com/repos/sauce-labs/web-app/branches?per_page=100": {
        body: [{ name: "main" }, { name: "feature/login" }],
      },
    });
    await expect(
      createGitHubClient(github.fetch, "t").listBranches(
        "sauce-labs",
        "web-app"
      )
    ).resolves.toEqual(["main", "feature/login"]);
  });
});

describe("GitHub client errors", () => {
  it("reports a bad credential by status and GitHub's message", async () => {
    const github = fakeGitHub({
      "https://api.github.com/orgs/sauce-labs/repos?per_page=100&sort=full_name":
        { body: { message: "Bad credentials" }, status: 401 },
    });
    await expect(
      createGitHubClient(github.fetch, "expired").listRepositories("sauce-labs")
    ).rejects.toThrow("GitHub responded 401: Bad credentials");
  });
});

describe("GitHub client file contents", () => {
  it("decodes a file from one branch, or reports it missing", async () => {
    const github = fakeGitHub({
        "https://api.github.com/repos/sauce-labs/web-app/contents/package.json?ref=main":
          {
            body: {
              content: Buffer.from('{"name":"web-app"}\n').toString("base64"),
              encoding: "base64",
            },
          },
      }),
      client = createGitHubClient(github.fetch, "ghp_abc123");
    await expect(
      client.readFile("sauce-labs", "web-app", "package.json", "main")
    ).resolves.toBe('{"name":"web-app"}\n');
    await expect(
      client.readFile("sauce-labs", "web-app", "Dockerfile", "main")
    ).resolves.toBeUndefined();
  });
});
