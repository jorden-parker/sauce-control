# 04: Build and run one Instance

**What to build:** A reviewer configures a Repository once (build command, start command, port, environment variables) and the tool clones a branch, builds it in a hardened container that listens on `localhost:3000` inside the container, and reports it ready. Closing the tool kills the container. A crashed previous session is cleaned up on startup.

**Blocked by:** 02 (GitHub access and ComboBoxes), 03 (Container Runtime picker)

**Status:** ready-for-agent

- [ ] Repository Config screen with build and start commands and port pre-filled from the package manifest, editable and saved
- [ ] Warning shown when the start command looks like a production server
- [ ] Environment variables pasted per Repository are stored in the keychain; an explicit opt-in checkbox with a warning allows using the clone's `.env.local`
- [ ] Clone over HTTPS with the token; uses a matching checkout in the Code Directory as a clone reference when present, and works without one
- [ ] Container uses the Repository Dockerfile if present, otherwise a generated one from the configured commands
- [ ] Container runs with no host network, all capabilities dropped, memory and CPU caps, and a read-only build context
- [ ] Readiness wait on port 3000 inside the container, with a clear error when the runtime is not running
- [ ] Containers labelled with a session id; removed by label on exit (`SIGINT`, `SIGTERM`, uncaught error) and swept on startup
- [ ] Smoke test per runtime, skipped when that runtime is absent, covering start, exit cleanup, and startup sweep
