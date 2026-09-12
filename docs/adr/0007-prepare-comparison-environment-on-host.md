---
status: accepted
---

# Prepare Comparison environment on the host

Provide an explicit Environment Setup Command separate from dependency installation, executed on the host so it can use the user's installed authentication tools and login state. Run it once per new Comparison in the user's login shell from their home directory, capture exported variables added or changed by setup, and apply them after Environment Files to produce one in-memory snapshot for both Instances and their restarts.

This extends ADR 0006: setup variables may serve installation and development, while `NODE_AUTH_TOKEN` remains installation-only and container execution settings remain controlled by Sauce Control. Environment Files remain literal data; only the explicitly configured command executes shell code. Preserve stdin-based credential delivery and avoid persisting captured values. The trade-off is supporting host command execution and its lifecycle instead of requiring company authentication tools and login state inside the containers.

Implemented with separate export capture and suppressed raw output. Setup supports browser authentication, a five-minute timeout and cancellation; terminal prompts are unsupported. Package updates require a new Comparison and fresh setup.

The command is now configured once in Settings for the whole app, with a link from Compare. See the [central setup design](../central-environment-setup-design.md) for migration from per-Repository settings and explicit resolution of conflicting saved commands.
