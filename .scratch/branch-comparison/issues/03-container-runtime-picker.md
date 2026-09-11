# 03: Container Runtime picker

**What to build:** A reviewer with Docker, Podman, or both installed sees which are present, their versions, and whether each is running, picks one, and the choice is remembered. A stopped runtime can be started from the tool.

**Blocked by:** 01 (Scaffold app with Geist theme)

**Status:** ready-for-agent

- [ ] Detects installed runtimes via the shared CLI surface only (no SDKs)
- [ ] Only one installed: used silently with no prompt
- [ ] Both installed and nothing saved: picker shows version and running/stopped state per runtime with nothing preselected; choice is saved
- [ ] Saved runtime no longer installed: explicit prompt to switch, never a silent fallback
- [ ] Choosing a stopped runtime offers to start it (`podman machine start` or opening Docker Desktop) and waits for readiness
- [ ] Settings page shows the saved runtime with its live state
- [ ] Tests cover all four rules with a fake runtime detector; behaviour matches ADR 0001
