# Environment Setup Command

Status: accepted and implemented.

## Settled decisions

- Provide a separate Environment Setup Command input. Sauce Control continues to run the dependency installation command separately.
- Additional environment variables are needed for both dependency installation and the development server.
- Setup runs on the host using the user's installed tools and login state.
- The stated reason for retaining `NODE_AUTH_TOKEN` after initial installation is updating packages, rather than authentication by the running application.
- For this feature, package updates require a new Comparison and fresh environment setup; updating packages within a retained Instance is out of scope. Keep `NODE_AUTH_TOKEN` installation-only.
- Allow setup to wait for browser-based authentication with a visible waiting state. Interactive terminal prompts are out of scope. This is intended behavior, not yet verification of how Pizzabox authenticates.
- Save one app-wide command in Settings and run it once before each new Comparison. Both Instances receive one captured snapshot; individual Instance restarts reuse it.
- Execute using the user's login shell, starting in their home directory. Sourced files should use absolute paths or `~/…`.
- Capture exported variables added or changed by setup, rather than forwarding the entire host environment. Setup values override matching Environment File values.
- Keep container execution settings, including `PATH`, `HOME` and `PORT`, under Sauce Control's control.
- Place an optional Environment Setup Command field in Settings, linked from Compare. An empty field skips setup. Persist command text, never captured variable values.
- If setup fails, is cancelled, or exceeds five minutes, stop the Comparison before dependency installation. Show a clear error and retry option; do not fall back to stale credentials.
- Show setup progress and exit status, suppressing raw command output because it may contain credentials. Browser authentication may open normally; terminal prompts are unsupported.

Central placement and legacy migration are specified in the [central setup design](./central-environment-setup-design.md).

## Architecture decision

[ADR 0007](./adr/0007-prepare-comparison-environment-on-host.md) records the host execution boundary and the extension to ADR 0006. Setup variables may reach installation and development, except that `NODE_AUTH_TOKEN` remains installation-only and reserved execution settings remain under Sauce Control's control. Existing Environment Files continue to be parsed as literal data.

## Execution contract

Run the configured command and capture its resulting exported environment within the same shell session so that `source` affects the captured values. Do not interpret ordinary stdout as environment data. Compare the exported environment immediately before and after setup; transport only added or changed application variables, excluding reserved execution settings. Unexported shell variables are not captured, and unsetting a variable is not a request to delete an Environment File value.

Support sh, bash, zsh and fish login shells. The command uses the syntax of that shell; chain required steps with `&&` so a failed step prevents subsequent steps. Both capture helpers run in the same session as setup, with a dedicated pipe separate from discarded stdout and stderr. The baseline is taken after login initialization so unchanged login variables are not imported.

Retain existing keychain and ordered Environment File merging, then overlay captured setup values. Capture one result for both Instances and deliver credentials through the existing stdin transport, without credential payload files or credentials in command arguments. Setup does not mutate Sauce Control's own process environment. Dispose of the snapshot when the Comparison ends or fails.

Keep setup cancellation and timeout tied to the Comparison lifecycle, terminating its owned subprocesses and preventing either installation from starting after failure. Retrying starts fresh setup. Raw stdout, stderr and captured values must not appear in progress messages, error messages or persisted logs.

The saved command may reference a sourced file, but Environment Files themselves are never automatically executed. The example requires replacing `[path]` with the actual absolute path or `~/…` path. Users provide the setup portion only; the existing dependency installation field contains `pnpm install` or their chosen installation command.

## Implementation verification

- Verify optional command save, reload and clearing across Repositories and Organisations.
- Use synthetic setup commands to verify same-shell sourcing, export capture, merge precedence, exclusion of unchanged host variables and protection of reserved settings.
- Verify one execution per Comparison, identical delivery to both Instances, restart reuse and fresh execution for a new Comparison.
- Verify setup variables reach both stages while `NODE_AUTH_TOKEN` reaches only dependency installation.
- Exercise failure, cancellation, timeout and retry; neither Instance may install after failed setup.
- Verify synthetic credentials printed by setup do not reach logs, errors, saved settings or container inspection. Preserve the existing credential-delivery checks on Docker and Podman.
- Verify the field and setup progress/error states through the browser. Actual Pizzabox authentication behavior remains an integration check; its compatibility has not been established by the interview.

## Motivating example

The user currently runs `pizzabox token update && pizzabox token env --repo pnpm && source [path] && pnpm install`. The new input covers environment setup; dependency installation remains separate.

Existing dependency installation runs inside a container. The container does not provide the host's Pizzabox installation, login state or environment-file paths by default.

## Verification results

Synthetic tests cover bash, zsh and fish sourcing, capture and merge rules, failed chains, missing shells, early exit, unsupported terminal reads, timeout and cancellation of child processes. Comparison tests cover fresh setup, snapshot delivery and failure before Instance startup. Browser verification covers the field, persistence and clearing, safe failure output, cancellation and successful retry.

Live Docker tests passed for direct installation and npm installation, including setup values at both stages, installation-only `NODE_AUTH_TOKEN`, suppressed output, inspection/history protection and restart snapshot reuse. Adapter tests exercise Docker and Podman transport. Live Podman tests were skipped because this machine has no configured Podman VM. Actual Pizzabox authentication was not executed; the tests use synthetic credentials.
