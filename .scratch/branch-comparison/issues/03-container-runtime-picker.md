# 03: Container Runtime picker

**What to build:** A reviewer with Docker, Podman, or both installed sees which are present, their versions, and whether each is running, picks one, and the choice is remembered. A stopped runtime can be started from the tool.

**Blocked by:** 01 (Scaffold app with Geist theme)

**Status:** in-review

- [x] Detects installed runtimes via the shared CLI surface only (no SDKs)
- [x] Only one installed: used silently with no prompt
- [x] Both installed and nothing saved: picker shows version and running/stopped state per runtime with nothing preselected; choice is saved
- [x] Saved runtime no longer installed: explicit prompt to switch, never a silent fallback
- [x] Choosing a stopped runtime offers to start it (`podman machine start` or opening Docker Desktop) and waits for readiness
- [x] Settings page shows the saved runtime with its live state
- [x] Tests cover all four rules with a fake runtime detector; behaviour matches ADR 0001

## Comments

2026-09-11: Implemented test-first. Domain rules in `src/container-runtime/runtime-choice.ts` (four ADR 0001 rules plus "nothing installed"), start-and-wait in `start-runtime.ts` with a manual-start hint on timeout, real CLI adapter in `cli-runtime-adapter.ts` with a detection-only smoke test. Settings store persists the choice; server actions save and start; the Settings page card covers all four states. Starting Docker uses `open -a Docker` on macOS and `systemctl start docker` elsewhere; neither has been exercised end to end on a real machine yet.
