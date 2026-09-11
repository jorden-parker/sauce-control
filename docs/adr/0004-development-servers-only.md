---
status: accepted
---

# Compare development servers only

Every Instance runs a development server. Sauce Control installs dependencies and starts that server; it must not offer or execute a production application build. This supersedes ADR 0001's choice to use a Repository Dockerfile when present: Sauce Control owns the development container setup and ignores Repository Dockerfiles. Configured commands must not silently select a production workflow. Credential delivery is defined in ADR 0006.

This decision reflects the intended comparison workflow, even when a repository provides a production Dockerfile. The existing implementation has not yet been updated to follow it.

Of the values imported from Environment Files, only `NODE_AUTH_TOKEN` is supplied during dependency installation. It is withheld from development-server execution, which receives the remaining imported values.

Discover the development command from `package.json`: prefer `scripts.dev`, then `scripts.develop`, using the declared package manager. When neither script exists, require an explicit development-server command; do not automatically fall back to `start`.
