---
status: accepted
---

# Run each Instance in its own container so both see `localhost:3000`

The repository-Dockerfile, build-command and `.env.local` delivery decisions below are superseded by [development-only execution](./0004-development-servers-only.md) and [stdin credential delivery](./0006-deliver-comparison-credentials-through-stdin.md). Container isolation and the shared runtime CLI remain in effect.

Some applications under comparison hard-code `localhost:3000` as an OAuth redirect URI, and two processes cannot bind the same port on the host. We run each Instance in an isolated container network namespace where it genuinely listens on `localhost:3000`, and a host-side proxy routes into each container. This makes a container runtime a hard dependency and the primary build path (Dockerfile if present, otherwise one generated from the Repository's build and start commands). The runtime is Docker or Podman, chosen by the user; when only one is installed it is used silently, when both are installed the user is asked once, with each runtime's version and running/stopped state shown and nothing preselected, and the choice is saved; choosing a stopped runtime offers to start it; and a saved runtime that is later missing produces an explicit prompt rather than a silent fallback; the tool drives it through the shared CLI surface only, never a runtime-specific SDK, so either works unchanged.

## Considered Options

- **Distinct ports (3001/3002) plus `base.localhost` / `target.localhost` host aliases**: breaks apps that compare the exact host string or redirect to `localhost:3000`.
- **Rewrite `Location` headers and OAuth callbacks in the proxy**: fragile, app-specific.
- **One Instance at a time**: defeats side-by-side interaction sync.

## Consequences

- On macOS both runtimes need a VM (Docker Desktop or `podman machine`); the tool checks it is running and reports how to start it.
- Containers are labelled with a session id; the tool removes all matching containers on exit and sweeps leftovers on startup.
- Containers run with no host network, capability drop, resource caps, and a read-only build context. Environment variables come from the keychain or an explicit per-Repository opt-in to the clone's `.env.local`.
