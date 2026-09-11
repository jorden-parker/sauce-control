# Plan 001: Store the GitHub request log in SQLite instead of a JSON-lines file

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat eedfdd8..HEAD -- src/github/request-log.ts src/github/request-log.test.ts src/instance/session-bootstrap.ts src/settings/data-directory.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `eedfdd8`, 2026-09-11

## Why this matters

Every request Sauce Control makes to GitHub (REST calls and git clones) is appended as one JSON line to `github-requests.log` in the data directory. The maintainer wants to answer "are we sending too many requests, and from where?" A flat file answers that only with `grep` and `wc`. A SQLite table answers it with one query: requests per session, per caller, per hour, or the lowest rate-limit remaining seen. The repo already uses Node's built-in `node:sqlite` for settings, so no dependency is added. This plan replaces the file with a table and keeps every existing behaviour (per-process count, console echo, exit summary) working.

## Current state

Files and their roles:

- `src/github/request-log.ts` — the log. `createGitHubRequestLog(filePath, sink?)` appends JSON lines; `loggingFetch` wraps `fetch` for `api.github.com`; `gitHubRequestLog()` is the process-wide singleton.
- `src/github/request-log.test.ts` — tests the log through an in-memory `sink` and `loggingFetch`.
- `src/instance/session-bootstrap.ts:98` — exit summary prints the count and the file path.
- `src/settings/data-directory.ts` — `dataDirectory()` and `settingsDatabasePath()`; the only place file names under the data directory are defined.
- `src/settings/settings-store.ts` — the exemplar for `node:sqlite` use in this repo.
- Importers of `gitHubRequestLog()` / `GitHubRequestLog` that must keep compiling unchanged: `src/github/github.ts`, `src/instance/run-instance.ts`, `src/instance/clone-branch.ts`, `src/comparison/current-comparison.ts`.

Excerpt, `src/github/request-log.ts:30` and `:43-62` (the part being replaced):

```ts
export const GITHUB_REQUEST_LOG_FILE = "github-requests.log";
// ...
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
```

Excerpt, `src/github/request-log.ts:113-121`:

```ts
let processLog: GitHubRequestLog | undefined;

/** The process-wide log under the data directory. */
export const gitHubRequestLog = (): GitHubRequestLog => {
  processLog ??= createGitHubRequestLog(
    join(dataDirectory(), GITHUB_REQUEST_LOG_FILE)
  );
  return processLog;
};
```

The entry shape (`src/github/request-log.ts:6-27`), which must not change:

```ts
export interface GitHubRequestEntry {
  caller: string;
  durationMs: number;
  kind: "api" | "git";
  method: string;
  path: string;
  rateLimitRemaining?: number;
  rateLimitReset?: number;
  status: number | string;
  timestamp: string;
}
export interface GitHubRequestLog {
  count: () => number;
  record: (entry: GitHubRequestEntry) => void;
}
```

Excerpt, `src/instance/session-bootstrap.ts:97-99`:

```ts
console.info(
  `${gitHubRequestLog().count()} GitHub request(s) this session; see ${join(dataDirectory(), "github-requests.log")}.`
);
```

Exemplar for SQLite in this repo, `src/settings/settings-store.ts:1` and `:72-82`:

```ts
import { DatabaseSync } from "node:sqlite";
// ...
export const openSettingsStore = (databasePath: string): SettingsStore => {
  const database = new DatabaseSync(databasePath);
  database.exec(
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
  );
  const select = database.prepare("SELECT value FROM settings WHERE key = ?"),
    upsert = database.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ),
```

Exemplar for a SQLite test, `src/settings/settings-store.test.ts:7-8`: a fresh temp directory per test via `mkdtempSync(join(tmpdir(), "sauce-control-"))`.

Conventions to match (observed across `src/`):

- Arrow functions assigned to `const`, one `const` chain per group (`one-var` lint rule). No classes.
- Factory functions named `create…` / `open…` return an interface; a lazy process-wide singleton lives beside them (`settings()` in `src/settings/settings.ts`, `gitHubRequestLog()` here).
- Doc comments in domain vocabulary from `CONTEXT.md`: "Comparison", "Instance", "Repository", "Organisation". The log records _GitHub requests_; the session id is the per-process id from `src/instance/current-session.ts`.
- Tests: vitest, `describe`/`it` with sentence-style names, no mocks of the module under test. Run with `pnpm test`.
- Files must pass `pnpm lint` (oxlint) and `pnpm format:check` (oxfmt). Run `pnpm format` to fix formatting.

Design decisions already made for this plan (do not reopen):

- **Separate database file** `github-requests.db` in the data directory, not a new table inside `settings.db`. Reason: the settings store is a key/value module with its own connection; a second module writing to the same file would need shared connection handling for `SQLITE_BUSY`. One file per concern is simpler.
- **Replace** the JSON-lines file, do not keep writing both. Remove `GITHUB_REQUEST_LOG_FILE` and the `appendFileSync` import.
- Keep the `SAUCE_CONTROL_LOG_GITHUB=1` console echo.
- Add a `session_id` column so a query can group by process run. The value comes from the caller of `createGitHubRequestLog`, not from importing `current-session.ts` into the log module (keeps the module free of app state and easy to test).

## Commands you will need

| Purpose   | Command                                | Expected on success                         |
| --------- | -------------------------------------- | ------------------------------------------- |
| Typecheck | `pnpm typecheck`                       | exit 0, no output after the script line     |
| Tests     | `pnpm vitest run src/github`           | all pass                                    |
| All tests | `pnpm test`                            | all pass (2 smoke tests may be skipped)     |
| Lint      | `pnpm lint`                            | no lines containing `: error`               |
| Format    | `pnpm format` then `pnpm format:check` | "All matched files use the correct format." |

Note: `pnpm lint` may print errors from `.claude/worktrees/...`. Those are another agent's worktree, not this repo's source. Ignore lines whose path starts with `.claude/`.

## Scope

**In scope** (the only files you should modify):

- `src/github/request-log.ts`
- `src/github/request-log.test.ts`
- `src/settings/data-directory.ts` (add one path helper)
- `src/instance/session-bootstrap.ts` (one message string)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch, even though they look related):

- `src/settings/settings-store.ts` and `settings.ts` — a different store; do not add a table there.
- `src/github/github.ts`, `src/instance/clone-branch.ts`, `src/instance/run-instance.ts`, `src/comparison/current-comparison.ts` — they only call `record`/`count`; the interface does not change, so they need no edits.
- Any UI. A Settings card showing request counts is a possible follow-up, not this plan.
- `.scratch/`, `docs/adr/`, `CONTEXT.md` — no new vocabulary is introduced.

## Git workflow

- Work on `main` directly; this repo does not use PRs unless asked.
- One commit at the end. Message style from `git log`: `feat: ...` / `fix: ...` / `refactor: ...` in the imperative, e.g. `refactor: store the GitHub request log in SQLite`.
- Do not add any `Co-Authored-By` or tool trailer to the commit message.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Add the database path helper

In `src/settings/data-directory.ts`, below `settingsDatabasePath`, add:

```ts
export const gitHubRequestsDatabasePath = (): string =>
  join(dataDirectory(), "github-requests.db");
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Rewrite the log factory over `node:sqlite`

In `src/github/request-log.ts`:

1. Replace `import { appendFileSync } from "node:fs";` with `import { DatabaseSync } from "node:sqlite";`.
2. Change the `dataDirectory` import to `import { gitHubRequestsDatabasePath } from "@/settings/data-directory";` and drop `join` from `node:path` if nothing else uses it (check: `loggingFetch` does not).
3. Delete `export const GITHUB_REQUEST_LOG_FILE = "github-requests.log";`.
4. Delete the `withoutUndefined` helper only if nothing else uses it; the console echo below still needs a JSON line, so keep it.
5. Replace `createGitHubRequestLog` with this shape:

```ts
/** Options for opening the log: where the database lives and which process run is writing. */
export interface GitHubRequestLogOptions {
  databasePath: string;
  sessionId: string;
}

/** A log storing one row per GitHub request in SQLite; `count` is this process's total. */
export const createGitHubRequestLog = ({
  databasePath,
  sessionId,
}: GitHubRequestLogOptions): GitHubRequestLog => {
  const database = new DatabaseSync(databasePath);
  database.exec(`CREATE TABLE IF NOT EXISTS github_requests (
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
  )`);
  database.exec(
    "CREATE INDEX IF NOT EXISTS github_requests_session ON github_requests (session_id)"
  );
  const insert = database.prepare(
    `INSERT INTO github_requests
       (session_id, timestamp, kind, caller, method, path, status, duration_ms, rate_limit_remaining, rate_limit_reset)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let total = 0;
  return {
    count: () => total,
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
```

`status` is stored as text because the entry type allows a number (HTTP status) or a string (`ok` / `failed` for git). Store numbers as their decimal string.

6. Add a read side so tests and future callers can query without SQL. Extend the `GitHubRequestLog` interface with one method and implement it in the same factory:

```ts
export interface GitHubRequestLog {
  count: () => number;
  /** Every row written by `sessionId` (defaults to this process's), oldest first. */
  entries: (
    sessionId?: string
  ) => (GitHubRequestEntry & { sessionId: string })[];
  record: (entry: GitHubRequestEntry) => void;
}
```

Implementation: `SELECT ... FROM github_requests WHERE session_id = ? ORDER BY id` and map columns back to the entry shape. Convert `status` back to a number when `/^\d+$/u` matches it; leave `rateLimitRemaining` / `rateLimitReset` out of the object when the column is `NULL` (the tests below assert with `toMatchObject`, so exact key presence is not required, but do not emit `undefined`-valued keys in stored form).

Adding a method to the interface is safe for the fakes: `grep -rn "GitHubRequestLog" src` shows no object literal implements the interface outside `request-log.ts`; every consumer only calls `record` and `count`.

7. Replace the singleton. Its signature `gitHubRequestLog()` must stay parameterless because out-of-scope files call it that way; the session id comes from the process module instead:

```ts
import { currentSessionId } from "@/instance/current-session";
// ...
let processLog: GitHubRequestLog | undefined;

/** The process-wide log in the data directory, tagged with this process's session id. */
export const gitHubRequestLog = (): GitHubRequestLog => {
  processLog ??= createGitHubRequestLog({
    databasePath: gitHubRequestsDatabasePath(),
    sessionId: currentSessionId,
  });
  return processLog;
};
```

`src/instance/current-session.ts` is four lines and imports only `node:crypto`, so this introduces no import cycle. (The earlier design note about keeping app state out of the module applies to `createGitHubRequestLog`, which stays pure; only the singleton reads the process id.)

**Verify**: `pnpm typecheck` → exit 0. If it reports errors in `src/github/request-log.test.ts` only, that is expected until Step 4.

### Step 3: Update the exit summary

In `src/instance/session-bootstrap.ts`, replace the message at line ~98 so it names the database. Import `gitHubRequestsDatabasePath` from `@/settings/data-directory` and use:

```ts
console.info(
  `${gitHubRequestLog().count()} GitHub request(s) this session; see ${gitHubRequestsDatabasePath()}.`
);
```

If `join` and `dataDirectory` are now unused in that file, remove them; if `dataDirectory` is still used by `comparisonsDirectory()`, keep it.

**Verify**: `pnpm typecheck` → exit 0 (ignoring the test file). `grep -rn "github-requests.log" src` → no matches.

### Step 4: Rewrite the tests against a real temporary database

In `src/github/request-log.test.ts`, replace the `memoryLog` helper with one that opens a fresh database per test:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const freshLog = (sessionId = "session-1") =>
  createGitHubRequestLog({
    databasePath: join(
      mkdtempSync(join(tmpdir(), "sauce-control-")),
      "github-requests.db"
    ),
    sessionId,
  });
```

Keep the four existing test cases; change each assertion that read `lines[0]` to read `log.entries()[0]` and `lines` to `log.entries()`. Add two cases:

- **Rows survive reopening**: record one entry, open a second log on the same `databasePath` with the same `sessionId`, assert `entries()` has one row with the same `path`. (Model after the "returns the saved Organisation after reopening the same file" test in `src/settings/settings-store.test.ts`.)
- **Entries are per session**: two logs on the same database with session ids `a` and `b`, one record each; `logA.entries()` has one row, `logA.entries("b")` has one row with the other path.

Also assert in the first test that `entries()[0].sessionId` equals `"session-1"` and that `status` round-trips as the number `200`, and in the git test that `status` round-trips as the string `"ok"`.

**Verify**: `pnpm vitest run src/github` → all pass, 6 tests in `request-log.test.ts`.

### Step 5: Lint, format, full suite

Run `pnpm format`, then `pnpm lint`, `pnpm format:check`, `pnpm test`.

If oxlint reports `no-magic-numbers` or `sort-keys` warnings in your new code, those are warnings, not errors; leave them unless trivial. Any line containing `: error` in a path under `src/` must be fixed.

**Verify**: `pnpm test` → all files pass. `pnpm lint 2>&1 | grep ": error" | grep -v "^.claude/"` → no output.

### Step 6: Manual check (optional but recommended)

```
SAUCE_CONTROL_DATA_DIR=$(mktemp -d) SAUCE_CONTROL_LOG_GITHUB=1 pnpm dev -p 3498
```

Open `http://127.0.0.1:3498/settings`, save an Organisation you can read with your `gh` login, open `http://127.0.0.1:3498/compare`, then Ctrl-C. Expected: console lines starting `[github]` during the compare page load, and on exit a line `N GitHub request(s) this session; see .../github-requests.db.` Then:

```
sqlite3 <that data dir>/github-requests.db 'select caller, count(*) from github_requests group by caller'
```

Expected: at least one row for `compare-page`. If `sqlite3` is not installed, skip the query; the exit line is enough.

## Test plan

- `src/github/request-log.test.ts` — rewrite as in Step 4: the four existing cases (api request fields, other hosts ignored, transport failure recorded, git transfer counted) plus reopening persistence and per-session filtering.
- Pattern: `src/settings/settings-store.test.ts` for the temp-directory-per-test and reopen structure.
- Verification: `pnpm vitest run src/github` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; `src/github/request-log.test.ts` has 6 passing tests
- [ ] `grep -rn "github-requests.log\|appendFileSync\|GITHUB_REQUEST_LOG_FILE" src/` returns no matches
- [ ] `grep -n "node:sqlite" src/github/request-log.ts` returns one match
- [ ] `git status --short` lists only the five in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" do not match `src/github/request-log.ts` or `src/instance/session-bootstrap.ts`.
- `grep -rn "GitHubRequestLog" src` shows an object literal implementing the interface outside `request-log.ts` (then the `entries` addition breaks a fake and the plan needs revising).
- `node:sqlite` fails to import under the project's Node version (`node --version` should be 22.5 or newer; `src/settings/settings-store.ts` already relies on it, so this would mean the environment differs from the repo's).
- A step's verification fails twice after a reasonable fix attempt.
- The change appears to need edits to `github.ts`, `clone-branch.ts`, `run-instance.ts`, or `current-comparison.ts`.

## Maintenance notes

- The table is created with `CREATE TABLE IF NOT EXISTS`; there is no migration system. If a column is added later, add it with `ALTER TABLE ... ADD COLUMN` guarded by a `PRAGMA table_info` check, following whatever `settings-store.ts` does at that time.
- `record` is synchronous and runs on the request path. One SQLite insert is well under a millisecond; if the log ever moves to a remote store, `record` must become fire-and-forget so a slow log never slows a GitHub call.
- The database is per data directory, so the Playwright suite (which sets `SAUCE_CONTROL_DATA_DIR` to a temp dir) gets its own and never pollutes the developer's.
- Deferred on purpose: a Settings card showing requests per caller and lowest rate-limit remaining, and any retention/pruning. Revisit once real numbers exist.
- Reviewer focus: the `status` text round-trip, `NULL` handling for the two rate-limit columns, and that no consumer outside `request-log.ts` changed.
