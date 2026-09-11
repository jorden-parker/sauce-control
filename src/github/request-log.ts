import { DatabaseSync } from "node:sqlite";
import { currentSessionId } from "@/instance/current-session";
import { gitHubRequestsDatabasePath } from "@/settings/data-directory";

/** One thing this tool asked GitHub for: a REST or GraphQL call, or a git transfer over HTTPS. */
export interface GitHubRequestEntry {
  /** Which feature made the request, e.g. `compare-page` or `clone-branch`. */
  caller: string;
  durationMs: number;
  kind: "api" | "git";
  /** HTTP method for `api`; the git subcommand for `git`. */
  method: string;
  /** Path and query for `api`; the repository path for `git`. Never a token. */
  path: string;
  rateLimitRemaining?: number;
  /** Unix seconds when the rate-limit window resets. */
  rateLimitReset?: number;
  /** HTTP status for `api`; `ok` or `failed` for `git`. */
  status: number | string;
  timestamp: string;
}

/** One stored row: the entry plus which process run wrote it. */
export type StoredGitHubRequest = GitHubRequestEntry & { sessionId: string };

/** Stores every GitHub request as one row and counts this process's. */
export interface GitHubRequestLog {
  /** How many requests this process has logged. */
  count: () => number;
  /** Every row written by `sessionId` (this process's by default), oldest first. */
  entries: (sessionId?: string) => StoredGitHubRequest[];
  record: (entry: GitHubRequestEntry) => void;
}

/** Where the rows live and which process run is writing. */
export interface GitHubRequestLogOptions {
  databasePath: string;
  sessionId: string;
}

interface Row {
  caller: string;
  duration_ms: number;
  kind: "api" | "git";
  method: string;
  path: string;
  rate_limit_remaining: number | null;
  rate_limit_reset: number | null;
  session_id: string;
  status: string;
  timestamp: string;
}

const API_HOST = "api.github.com",
  echoToConsole = (): boolean => process.env.SAUCE_CONTROL_LOG_GITHUB === "1",
  numberHeader = (headers: Headers, name: string): number | undefined => {
    const value = headers.get(name);
    return value === null ? undefined : Number(value);
  },
  withoutUndefined = <T extends object>(entry: T): T =>
    Object.fromEntries(
      Object.entries(entry).filter(([, value]) => value !== undefined)
    ) as T,
  SCHEMA = `CREATE TABLE IF NOT EXISTS github_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    kind TEXT NOT NULL,
    caller TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    rate_limit_remaining INTEGER,
    rate_limit_reset INTEGER
  );
  CREATE INDEX IF NOT EXISTS github_requests_session ON github_requests (session_id);`,
  HTTP_STATUS = /^\d+$/u,
  /** HTTP statuses come back as numbers; git outcomes (`ok`, `failed`) stay strings. */
  fromRow = (row: Row): StoredGitHubRequest =>
    withoutUndefined({
      caller: row.caller,
      durationMs: row.duration_ms,
      kind: row.kind,
      method: row.method,
      path: row.path,
      rateLimitRemaining: row.rate_limit_remaining ?? undefined,
      rateLimitReset: row.rate_limit_reset ?? undefined,
      sessionId: row.session_id,
      status: HTTP_STATUS.test(row.status) ? Number(row.status) : row.status,
      timestamp: row.timestamp,
    }) as StoredGitHubRequest;

/** A log storing one row per GitHub request in SQLite; `count` is this process's total. */
export const createGitHubRequestLog = ({
  databasePath,
  sessionId,
}: GitHubRequestLogOptions): GitHubRequestLog => {
  const database = new DatabaseSync(databasePath);
  database.exec(SCHEMA);
  const insert = database.prepare(
      `INSERT INTO github_requests
         (session_id, timestamp, kind, caller, method, path, status, duration_ms, rate_limit_remaining, rate_limit_reset)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    select = database.prepare(
      "SELECT * FROM github_requests WHERE session_id = ? ORDER BY id"
    );
  let total = 0;
  return {
    count: () => total,
    entries: (which = sessionId) =>
      (select.all(which) as unknown as Row[]).map(fromRow),
    record: (entry) => {
      total += 1;
      insert.run(
        sessionId,
        entry.timestamp,
        entry.kind,
        entry.caller,
        entry.method,
        entry.path,
        String(entry.status),
        entry.durationMs,
        entry.rateLimitRemaining ?? null,
        entry.rateLimitReset ?? null
      );
      if (echoToConsole()) {
        console.info(`[github] ${JSON.stringify(withoutUndefined(entry))}`);
      }
    },
  };
};

/** The subset of `fetch` the logger wraps; matches `FetchLike` in the client. */
type LoggedFetch = (
  url: string,
  init?: { headers?: Record<string, string>; method?: string }
) => Promise<Response>;

/** Wraps `fetch` so every call to `api.github.com` lands in the log; other hosts pass through untouched. */
export const loggingFetch =
  (fetch: LoggedFetch, log: GitHubRequestLog, caller: string): LoggedFetch =>
  async (url, init) => {
    const target = new URL(url);
    if (target.host !== API_HOST) {
      return fetch(url, init);
    }
    const startedAt = Date.now(),
      timestamp = new Date(startedAt).toISOString(),
      method = (init?.method ?? "GET").toUpperCase(),
      path = `${target.pathname}${target.search}`;
    try {
      const response = await fetch(url, init);
      log.record({
        caller,
        durationMs: Date.now() - startedAt,
        kind: "api",
        method,
        path,
        rateLimitRemaining: numberHeader(
          response.headers,
          "x-ratelimit-remaining"
        ),
        rateLimitReset: numberHeader(response.headers, "x-ratelimit-reset"),
        status: response.status,
        timestamp,
      });
      return response;
    } catch (error) {
      log.record({
        caller,
        durationMs: Date.now() - startedAt,
        kind: "api",
        method,
        path,
        status: "failed",
        timestamp,
      });
      throw error;
    }
  };

let processLog: GitHubRequestLog | undefined;

/** The process-wide log in the data directory, tagged with this process's session id. */
export const gitHubRequestLog = (): GitHubRequestLog => {
  processLog ??= createGitHubRequestLog({
    databasePath: gitHubRequestsDatabasePath(),
    sessionId: currentSessionId,
  });
  return processLog;
};
