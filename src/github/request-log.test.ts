import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGitHubRequestLog, loggingFetch } from "./request-log";

const freshDatabasePath = (): string =>
    join(mkdtempSync(join(tmpdir(), "sauce-control-")), "github-requests.db"),
  freshLog = (sessionId = "session-1") =>
    createGitHubRequestLog({ databasePath: freshDatabasePath(), sessionId }),
  cloneEntry = {
    caller: "clone-branch",
    durationMs: 12,
    kind: "git" as const,
    method: "clone",
    path: "/sauce-labs/web-app.git#main",
    status: "ok",
    timestamp: "2026-09-11T00:00:00.000Z",
  };

describe("GitHub request log storage", () => {
  it("keeps rows across reopening the same database", () => {
    const databasePath = freshDatabasePath(),
      first = createGitHubRequestLog({ databasePath, sessionId: "session-1" });
    first.record(cloneEntry);
    expect(first.count()).toBe(1);

    const second = createGitHubRequestLog({
      databasePath,
      sessionId: "session-1",
    });
    expect(second.count()).toBe(0);
    expect(second.entries()).toEqual([
      { ...cloneEntry, sessionId: "session-1" },
    ]);
  });

  it("filters entries by session so two runs sharing one database stay apart", () => {
    const databasePath = freshDatabasePath(),
      a = createGitHubRequestLog({ databasePath, sessionId: "a" }),
      b = createGitHubRequestLog({ databasePath, sessionId: "b" });
    a.record(cloneEntry);
    b.record({ ...cloneEntry, path: "/sauce-labs/docs.git#main" });

    expect(a.entries()).toHaveLength(1);
    expect(a.entries("b")).toEqual([
      { ...cloneEntry, path: "/sauce-labs/docs.git#main", sessionId: "b" },
    ]);
  });
});

describe("logging GitHub requests through fetch", () => {
  it("records method, path, numeric status, caller, and rate-limit headers for api.github.com", async () => {
    const log = freshLog(),
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

    const [entry] = log.entries();
    expect(entry).toMatchObject({
      caller: "compare-page",
      kind: "api",
      method: "GET",
      path: "/orgs/sauce-labs/repos?per_page=100",
      rateLimitRemaining: 4999,
      rateLimitReset: 1_760_000_000,
      sessionId: "session-1",
      status: 200,
    });
    expect(entry?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(log.count()).toBe(1);
  });

  it("leaves other hosts alone", async () => {
    const log = freshLog(),
      fetch = loggingFetch(
        () => Promise.resolve(new Response("ok")),
        log,
        "compare-page"
      );

    await fetch("https://example.com/");

    expect(log.entries()).toEqual([]);
  });

  it("records a failed transport as status failed without rate-limit fields and rethrows", async () => {
    const log = freshLog(),
      fetch = loggingFetch(
        () => Promise.reject(new Error("offline")),
        log,
        "compare-page"
      );

    await expect(fetch("https://api.github.com/user")).rejects.toThrow(
      "offline"
    );
    const [entry] = log.entries();
    expect(entry).toMatchObject({ path: "/user", status: "failed" });
    expect(entry).not.toHaveProperty("rateLimitRemaining");
  });
});
