# 04: Build and run one Instance

**What to build:** A reviewer configures a Repository once (build command, start command, port, environment variables) and the tool clones a branch, builds it in a hardened container that listens on `localhost:3000` inside the container, and reports it ready. Closing the tool kills the container. A crashed previous session is cleaned up on startup.

**Blocked by:** 02 (GitHub access and ComboBoxes), 03 (Container Runtime picker)

**Status:** in-review

- [x] Repository Config screen with build and start commands and port pre-filled from the package manifest, editable and saved
- [x] Warning shown when the start command looks like a production server
- [x] Environment variables pasted per Repository are stored in the keychain; an explicit opt-in checkbox with a warning allows using the clone's `.env.local`
- [x] Clone over HTTPS with the token; uses a matching checkout in the Code Directory as a clone reference when present, and works without one
- [x] Container uses the Repository Dockerfile if present, otherwise a generated one from the configured commands
- [x] Container runs with no host network, all capabilities dropped, memory and CPU caps, and a read-only build context
- [x] Readiness wait on port 3000 inside the container, with a clear error when the runtime is not running
- [x] Containers labelled with a session id; removed by label on exit (`SIGINT`, `SIGTERM`, uncaught error) and swept on startup
- [x] Smoke test per runtime, skipped when that runtime is absent, covering start, exit cleanup, and startup sweep

## Comments

2026-09-11: Implemented test-first. Seams: `inferRepositoryConfig` / `looksLikeProductionServer` (manifest to commands, script aliases resolved), `SettingsStore` Repository Config and Code Directory, `parseEnvironment` with keychain load/save under `environment:<repository>`, `cloneBranch` (HTTPS with the token, `--filter=blob:none`, `--reference` to the Code Directory checkout when present, token redacted from errors), `generateDockerfile` (drops `.env*` unless opted in), `runInstance` (runtime-running check before cloning, Repository Dockerfile or generated one on stdin, session and branch labels, `/proc/net/tcp` readiness poll, container removed on timeout), session cleanup (`removeSessionContainers`, `sweepLeftovers`, `registerExitCleanup` for SIGINT/SIGTERM/uncaughtException), and the CLI adapter's container operations with a fake shell. Smoke test `run-instance.smoke.test.ts` builds and runs a fixture app on the real runtime, fetches it through the loopback host port, cleans up, and sweeps a fake crashed session; skipped when the runtime is absent or stopped. Verified end to end on Docker via Colima; Podman path is covered by the same test but not exercised on this machine.

Hardening: `--cap-drop ALL --security-opt no-new-privileges --memory 4g --cpus 2 --pids-limit 1024 --tmpfs /tmp`, port published on `127.0.0.1` only, no host network. Environment variable values reach the runtime through the child process environment (`-e KEY` by name), never the argument list. Images are labelled with the session id and pruned with the containers. Startup sweep and exit cleanup run from `src/instrumentation.ts`; verified the sweep removes a stale labelled container when `next dev` starts.

UI: `/repositories/<repository>` shows the Repository Config pre-filled from `package.json` on the default branch (new `GitHubClient.readFile`), live production-server warning, keychain variable count, and the `.env.local` opt-in with its warning. Reached from the Comparison form. Covered by `e2e/repository-config.spec.ts` with `SAUCE_CONTROL_KEYCHAIN=memory` so the suite never touches the OS keychain.

Open point for ticket 05: the published host port only reaches an application that binds `0.0.0.0` inside the container. An app that binds `localhost` only will need the proxy to reach it another way (for example a small forwarder inside the container).
