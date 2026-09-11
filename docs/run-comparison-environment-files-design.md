# Environment Files and development-only Comparisons

Status: accepted and implemented. Docker and browser verification completed. Live credential-delivery verification also passed on macOS with Podman 6.1.1. Individual interview decisions are recorded in the [research notes](./environment-files-research.md), [development-only ADR](./adr/0004-development-servers-only.md) and [credential-delivery ADR](./adr/0006-deliver-comparison-credentials-through-stdin.md).

## Agreed workflow

Run Comparison offers an ordered list of Environment Files, a local file browser and editable paths. Users can add multiple files, remove entries and reorder them. Browsing can reach outside the Code Directory, within the local process's permissions. Follow the Geist design system for controls, typography and accessibility. Show paths and metadata, never credential values or file previews.

Remember only the ordered paths per Repository. On Run Comparison, read and validate every file before starting installation or either Instance. Begin with existing keychain variables, then overlay files in list order: later definitions win. Missing, unreadable or malformed files stop the run with a safe file/line error, without raw source lines or values. Never save imported values back to settings or the keychain.

Capture one merged snapshot for both Instances. Keep it only in Sauce Control process memory for the Comparison lifetime. Instance restarts reuse that snapshot; file edits apply only to a new Comparison.

## Development execution

Sauce Control controls the development container setup and ignores Repository Dockerfiles. Install dependencies and start development servers only. No production application build is offered or executed.

Read each branch's `package.json`. Discover `scripts.dev`, then `scripts.develop`, using the declared package manager. Require an explicit development-server command when neither exists. Never automatically fall back to `start`.

Only `NODE_AUTH_TOKEN` from the merged variables reaches dependency installation. The development server receives the remaining imported variables, without `NODE_AUTH_TOKEN`. This split applies equally to file values and existing keychain values.

The later [Environment Setup Command design](./environment-setup-command-design.md) extends this: additional exports captured from an explicit host setup command override matching file values and may reach both stages. `NODE_AUTH_TOKEN` remains installation-only, and Environment Files remain literal data.

Deliver structured values through stdin to a trusted launcher inside the container. Never put values into command arguments, host CLI environment overrides, container environment configuration or a separate secret store. The launcher creates the appropriate environment only for the intended child process. It must handle installation failure, readiness, process supervision, stopping and restart reinjection.

Suppress raw installation and server output at its source. Show controlled progress and safe error summaries only. Neither Sauce Control nor the runtime logger may persist or display raw child output.

## Accepted parsing defaults

- Accept UTF-8 `KEY=value` assignments, optional `export`, whitespace around assignments, blank lines and comments. Names use letters, digits and underscores and cannot begin with a digit.
- Single or double quotes delimit values and are removed. Quoted values may contain actual newlines. Preserve their contents literally: no variable expansion, command substitution or escape decoding. For example, the two characters `\n` remain two characters; an actual line break remains a line break.
- Outside quotes, a `#` at the start of a line or preceded by whitespace begins a comment. A `#` inside quotes or directly within an unquoted value is literal. Reject unterminated quotes and trailing non-comment text after a quoted value.
- Accept empty values. The last assignment to a key within a file wins, matching the agreed order between files.
- Reject invalid encoding, NUL characters and oversized inputs with safe errors. Use bounded file reads and payload sizes; do not read arbitrary streams or device files.

## Accepted operational defaults

Keep `NODE_ENV=development` and the configured Instance port under Sauce Control's control. Reject conflicting imported `NODE_ENV` or `PORT` values with a safe error. Imported variables never change the host CLI's `PATH`, Docker connection or other execution settings.

Rename the existing build-command concept to dependency installation in configuration and UI. Revalidate saved commands instead of executing an old production workflow. Where package-manager metadata is absent, infer it from an unambiguous lockfile, otherwise use npm; contradictory metadata produces a configuration error. Inspect known production command patterns before execution without claiming static inspection can prove arbitrary repository scripts safe.

Avoid copying credential inputs, repository environment files or `.git` into development images or source staging. Remove the legacy opt-in that bakes `.env.local` into an image. Do not rely on deleting copied secrets in a later layer. Keep source files read-only; store dependency outputs separately from originals. Staged package manifests and lockfiles are writable inside the disposable container: package managers may rewrite them even when dependencies are unchanged. Original checkout files remain untouched. Never mount original Environment Files into Instances, which would bypass the stage-specific variable split.

Create no on-disk credential payload files. Close delivery pipes after use. Release the Comparison snapshot when it ends or fails, and remove owned execution resources through the existing lifecycle. If Sauce Control has exited, an old container cannot resume without a new Comparison and fresh validation. Original Environment Files and previously saved keychain entries are not deleted.

The file browser exposes directory metadata only through local, same-origin application requests. Read values only server-side for validation/execution; do not add a general file-content endpoint. Preserve keyboard navigation, visible focus, accessible labels and errors, and show hidden environment files in the browser.

## Verification required before completion

Test parsing with quoted, multiline and hostile-looking literal inputs; ordered merging; empty overrides; safe failures; and stage-specific environments. Verify both Instances receive the same snapshot, restarts preserve it, and the next Comparison rereads edited files.

Use synthetic credentials on Docker and Podman to verify absence from command arguments, host CLI environment, container inspection, image contents, persisted settings, runtime logs and Sauce Control errors. Exercise child processes that print those credentials to both output streams and fail. Verify original files remain unchanged, cleanup runs on failure and stop, and `NODE_AUTH_TOKEN` never reaches the development server.

Check the Geist file browser through the full selection, reorder, save, reload and run flow. Verify development script discovery, no production fallback, and ignored Repository Dockerfiles.

The selected runtime must pass the delivery capability checks before receiving real credentials. Stop with actionable guidance when the required protection is unsupported; never silently weaken delivery. Live tests now cover Docker and Podman 6.1.1 on macOS, including a saved file using `export NODE_AUTH_TOKEN=…`, npm installation, output suppression, inspection and restart reinjection.

Installation regression: making every staged file read-only caused npm to fail with `EACCES` opening `/app/package-lock.json`, even for an offline install with no dependencies or lifecycle scripts. Making only staged package manifests and lockfiles writable fixes that failure without changing the original checkout. The live credential-delivery test now exercises npm with an existing lockfile, in addition to direct launcher delivery, so successful token transport alone cannot mask this installation failure.

## Protection boundary

The branch code and dependency installation scripts are trusted credential consumers. They may legitimately authenticate to external services. This design prevents accidental exposure through Sauce Control's handling; it does not hide credentials from local administrators, malicious branch code, or application behavior that deliberately publishes secrets in pages or network requests. Suppressing raw logs does not establish a general guarantee about application-generated files or browser assets.
