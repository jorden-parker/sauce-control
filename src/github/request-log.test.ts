import { describe, expect, it } from "vitest";
import {
  type GitHubRequestEntry,
  createGitHubRequestLog,
  loggingFetch,
} from "./request-log";

const memoryLog = () => {
  const lines: GitHubRequestEntry[] = [],
    log = createGitHubRequestLog("unused", (line) => {
      lines.push(JSON.parse(line) as GitHubRequestEntry);
    });
  return { lines, log };
};

describe("logging GitHub requests", () => {
  it("records method, path, status, caller, and rate-limit headers for api.github.com", async () => {
    const { lines, log } = memoryLog(),
      fetch = loggingFetch(
        () =>
          Promise.resolve(
            new Response("[]", {
              headers: {
                "x-ratelimit-remaining": "4999",
                "x-ratelimit-reset": "1760000000",
              },
              status: 200,
            })
          ),
        log,
        "compare-page"
      );

    await fetch("https://api.github.com/orgs/sauce-labs/repos?per_page=100");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      caller: "compare-page",
      kind: "api",
      method: "GET",
      path: "/orgs/sauce-labs/repos?per_page=100",
      rateLimitRemaining: 4999,
      rateLimitReset: 1_760_000_000,
      status: 200,
    });
    expect(lines[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(log.count()).toBe(1);
  });

  it("leaves other hosts alone", async () => {
    const { lines, log } = memoryLog(),
      fetch = loggingFetch(
        () => Promise.resolve(new Response("ok")),
        log,
        "compare-page"
      );

    await fetch("https://example.com/");

    expect(lines).toEqual([]);
  });

  it("records a failed transport as status failed and rethrows", async () => {
    const { lines, log } = memoryLog(),
      fetch = loggingFetch(
        () => Promise.reject(new Error("offline")),
        log,
        "compare-page"
      );

    await expect(fetch("https://api.github.com/user")).rejects.toThrow(
      "offline"
    );
    expect(lines[0]).toMatchObject({ path: "/user", status: "failed" });
  });

  it("counts git transfers recorded directly", () => {
    const { lines, log } = memoryLog();
    log.record({
      caller: "clone-branch",
      durationMs: 12,
      kind: "git",
      method: "clone",
      path: "/sauce-labs/web-app.git",
      status: "ok",
      timestamp: "2026-09-11T00:00:00.000Z",
    });
    expect(lines[0]).toMatchObject({ kind: "git", method: "clone" });
    expect(log.count()).toBe(1);
  });
});
