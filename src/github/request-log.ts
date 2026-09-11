import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { dataDirectory } from "@/settings/data-directory";

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

/** Appends every GitHub request to one file and counts them for this process. */
export interface GitHubRequestLog {
  /** How many requests this process has logged. */
  count: () => number;
  record: (entry: GitHubRequestEntry) => void;
}

export const GITHUB_REQUEST_LOG_FILE = "github-requests.log";

const API_HOST = "api.github.com",
  echoToConsole = (): boolean => process.env.SAUCE_CONTROL_LOG_GITHUB === "1",
  numberHeader = (headers: Headers, name: string): number | undefined => {
    const value = headers.get(name);
    return value === null ? undefined : Number(value);
  },
  withoutUndefined = (entry: GitHubRequestEntry): GitHubRequestEntry =>
    Object.fromEntries(
      Object.entries(entry).filter(([, value]) => value !== undefined)
    ) as GitHubRequestEntry;

/** A log writing JSON lines to `filePath`; `sink` replaces the file write in tests. */
export const createGitHubRequestLog = (
  filePath: string,
  sink: (line: string) => void = (line) => {
    appendFileSync(filePath, `${line}\n`);
  }
): GitHubRequestLog => {
  let total = 0;
  return {
    count: () => total,
    record: (entry) => {
      total += 1;
      const line = JSON.stringify(withoutUndefined(entry));
      sink(line);
      if (echoToConsole()) {
        console.info(`[github] ${line}`);
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

/** The process-wide log under the data directory. */
export const gitHubRequestLog = (): GitHubRequestLog => {
  processLog ??= createGitHubRequestLog(
    join(dataDirectory(), GITHUB_REQUEST_LOG_FILE)
  );
  return processLog;
};
