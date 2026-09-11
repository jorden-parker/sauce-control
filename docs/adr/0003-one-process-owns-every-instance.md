---
status: accepted
---

# One Sauce Control process owns every Instance carrying its app label

ADR 0001 labels each container with a session id so the process that started it can remove it on exit and sweep Leftovers on startup. That left two gaps: the startup sweep removed _every_ session's containers, including a second live Sauce Control's, and a process that crashed hard (`kill -9`, power loss) or exited while the Container Runtime was down left containers and clone directories nobody owned.

We now stamp every container and image with `sauce-control.app=<value>` as well as the session id, and treat the app label as ownership: the process with that value removes everything carrying it, both at startup and at exit, then lists the label again and reports anything still present. The value defaults to `sauce-control`; a second copy that must not interfere, such as the Playwright suite, sets `SAUCE_CONTROL_APP_LABEL` to its own value and gets its own data directory. Clone directories under the data directory are swept by the same rule: every session directory but the current one goes.

## Considered Options

- **Ownership by live process id**: store the PID in a label and sweep only sessions whose process is dead. Lets two Sauce Controls share a runtime, but PIDs are reused, containers outlive reboots, and the rule is invisible to the user. Rejected: one Sauce Control at a time is the intended use, and the label makes the exception explicit.
- **Session-only labels (status quo)**: a second process kills the first one's Instances mid-Comparison, and nothing distinguishes an e2e run from a developer's.
- **Stop the runtime VM too**: `podman machine stop` or quitting Docker Desktop would guarantee nothing survives, but the VM is the user's and may be running other things. Its state is logged, never changed.

## Consequences

- Running two Sauce Controls with the same app label is unsupported; the second one removes the first one's Instances on startup.
- When the runtime is stopped or no runtime is chosen, cleanup cannot verify anything and says so; containers held by a stopped runtime are stopped with it.
- The Settings page lists every Instance the runtime holds for this app label, including Leftovers, and can stop, start, or remove them.
- Restarting a stopped container reallocates its loopback port; the Proxy reads each Instance's host port per request so the new port takes effect.
