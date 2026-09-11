# 15: Stop every Instance on exit and log every GitHub request

**What to build:** When Sauce Control exits, nothing it started survives: Instances, images, the Proxy, running clones or builds, and clone directories. On startup, Leftovers from a crashed run go the same way, and anything still present is reported. The Settings page shows every Instance the Container Runtime holds and can stop, start, or remove them. Every GitHub REST call and every git transfer is appended to a log so the reviewer can see how many requests a session makes and which feature made them.

**Blocked by:** 05 (Two Instances behind the Proxy)

**Status:** in-review

- [x] Containers and images carry `sauce-control.app=<value>` (ADR 0003); the Playwright suite uses its own value
- [x] Startup removes every owned container, image, and clone directory, then lists the label again and reports anything left
- [x] Exit (SIGINT, SIGTERM, SIGHUP, uncaught error) stops the Comparison, kills live commands, removes every owned container and image and clone directory, verifies, and prints the GitHub request count
- [x] When the runtime is stopped or none is chosen, cleanup logs that it cannot verify instead of silently doing nothing
- [x] Settings page Instances card: Repository, branch, state, host port, age, container id, Leftover marker; Stop / Start per row; Stop and remove all
- [x] Every `api.github.com` request is stored as one row in `github-requests.db` (SQLite, `github_requests` table) in the data directory with session id, timestamp, caller, method, path, status, duration, and rate-limit headers; git clones are stored with `kind: "git"`
- [x] `SAUCE_CONTROL_LOG_GITHUB=1` echoes each entry to the console
- [x] Unit tests: ownership sweep leaves other app labels alone, Leftover directories, exit signals, Instances listing and stop/start, request log, adapter inspect/start/stop, Settings page card
- [x] Smoke test on the real runtime: a container from a "crashed" session with our label is removed and the label lists empty afterwards

## Comments

2026-09-11: Implemented after a grilling session. Seams: `src/instance/labels.ts` (label names and the app label value), `src/instance/session.ts` (remove all, remaining, Leftover directories, exit hook), `src/instance/instances.ts` (list, stop, start by id, refusing containers we do not own), `src/github/request-log.ts` (JSONL log and the `fetch` wrapper matched on host, so a future GraphQL call is logged without new code). `gitHubClient(caller)` now takes the calling feature's name; `InstanceDependencies.requestLog` carries the log into `cloneBranch`.

Found while verifying live: `next dev` handles SIGINT itself in the server child and exits within 100 ms, and the parent SIGKILLs the child after that window, so no `docker rm` could ever finish on Ctrl-C. The `dev` and `start` scripts (and the Playwright `webServer`) now set `NEXT_MANUAL_SIG_HANDLE=true` and `NEXT_EXIT_TIMEOUT_MS=90000`, so the exit hook owns shutdown. Verified by hand: a planted container with our label was removed on SIGINT and the exit log printed the GitHub request count.

Checked: `gh auth token` makes no API call (verified with `GH_DEBUG=api`), so the token subprocess is not logged. It still spawns once per client construction; caching it is the obvious next saving.

Not done: `unhandledRejection` is left to Node's default, which already surfaces as `uncaughtException` and so runs the same cleanup. No request budget or warning threshold yet; add once real counts are known. Stopping one Instance of the running Comparison from Settings leaves the Compare page reporting "running" until the Instance is started again.

2026-09-11 (later): The JSON-lines file was replaced by a SQLite database, `github-requests.db`, following `plans/001-github-request-log-in-sqlite.md`. Same `record`/`count` interface plus `entries(sessionId?)` for reading rows back; the singleton tags rows with the process session id. Tests were written first against a temporary database per test, modelled on the settings store tests. Query example: `sqlite3 ~/.sauce-control/github-requests.db 'select caller, count(*) from github_requests group by caller'`.
