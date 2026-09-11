# Environment files for Run Comparison

Research checked 2026-09-11. Design decisions are pending the grill-with-docs interview; this document does not approve an implementation.

## Current constraints

Each Comparison starts two Instances with shared runtime environment values. ADR 0001 chooses Docker or Podman through their shared CLI surface and describes keychain values or explicit use of the clone's `.env.local`. Native secret mechanisms would require revisiting that shared-surface decision.

The working-tree `plans/README.md` contains provisional conclusions about this feature, but its referenced plan 002 is absent. A browser file picker does not inherently require credential persistence: per-run uploads are possible, although automatic reuse after reload would need a separate design.

## Runtime mechanisms

- [Podman run secrets](https://docs.podman.io/en/latest/markdown/podman-run.1.html#secret-secret-opt-opt) support mounted files and environment injection using `--secret …,type=env,target=KEY`.
- [Podman secret creation](https://docs.podman.io/en/latest/markdown/podman-secret-create.1.html) accepts stdin. Its default file driver stores a read-protected file; the pass driver uses GPG encryption. Native secrets therefore do not imply encrypted storage by default.
- [Docker Swarm secrets](https://docs.docker.com/engine/swarm/secrets/) apply to services, not standalone containers. They are not directly interchangeable with the current container lifecycle.
- [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/) use file bind mounts. Applications must read those files, or an adapter must translate them into environment variables; `_FILE` is an application convention.
- [Docker pass](https://docs.docker.com/reference/cli/docker/pass/) documents OS-keychain storage and `se://` references for runtime environment injection. [Secrets Engine](https://github.com/docker/secrets-engine/blob/main/README.md) ships with Docker Desktop; Docker CE integration is experimental and requires Engine 29.2.0 or newer plus setup. It needs capability verification and cannot be assumed available on every supported Docker installation.
- [Docker build secrets](https://docs.docker.com/build/building/secrets/) are separate from runtime secrets. Build steps must explicitly consume secret mounts; runtime injection cannot supply private-package installation credentials during an image build.

### Inspection and delivery follow-up

Podman previously exposed environment-type secrets in inspection output ([issue 23788](https://github.com/podman-container-tools/podman/issues/23788)); [fix 23959](https://github.com/podman-container-tools/podman/pull/23959) addresses that issue. Native-secret branding alone is insufficient evidence of the required behavior; verify supported runtime versions with synthetic values.

Local CLI checks found Docker client 29.7.2, Docker server 29.5.2 and no Podman executable. `docker pass --help` did not expose a pass subcommand, so Secrets Engine support is not established on this installation. The implemented stdin delivery passed a live Docker smoke test with synthetic credentials, including stage separation, inspection, image history, suppressed logs and restart reinjection. Live Podman verification remains outstanding; adapter unit tests cover both CLI variants.

Both [Docker exec](https://docs.docker.com/reference/cli/docker/container/exec/) and [Podman exec](https://docs.podman.io/en/latest/markdown/podman-exec.1.html) support stdin delivery. The implemented shared mechanism sends structured values to a trusted in-container launcher over stdin, which creates only the intended child process environment. It includes process supervision, output suppression and snapshot reinjection on restart. Docker documents that exec processes are not automatically restarted with the container; the adapter therefore explicitly reinjects the development environment after container start, without rerunning installation or forwarding NODE_AUTH_TOKEN.

## Protection boundaries

The consuming application and administrators controlling its runtime can access supplied credentials. None of these mechanisms prevents branch code from transmitting a token or including it in generated assets. Environment compatibility retains this limitation even when values are delivered through a secret store.

Accepted boundary: prevent accidental external exposure through Sauce Control, assuming both branches are trusted to receive the credentials. Keep values out of displayed configuration, saved settings, process arguments and image layers, and explicitly address log and error exposure. This does not prohibit the application's intended use of credentials to authenticate to external services and does not promise protection from malicious branch code.

Accepted inspection protection: imported values must not appear in container configuration inspection output, including `docker inspect` and its Podman equivalent. Ordinary container environment configuration containing plaintext values does not meet this requirement. This does not promise to hide values from administrators who can read the running application's memory or execute commands inside its container.

Accepted restart behavior: capture merged variables once per Comparison and retain that snapshot only in Sauce Control process memory until the Comparison ends. Restarting either Instance reuses the same snapshot; file edits take effect only on the next Run Comparison. Do not reread files for an individual Instance restart or serialize the snapshot for recovery after Sauce Control exits.

Accepted delivery: send structured values through a process input pipe to a trusted launcher inside each container. The launcher supplies only the permitted variables to dependency installation and development-server execution. Do not place values in command text, container environment configuration or a separate secret store. Verify this behavior with synthetic credentials on Docker and Podman before considering the mechanism complete. See ADR 0006.

Accepted output policy: suppress raw dependency-installation and development-server logs. Show only controlled progress and safe error summaries. Do not rely on string redaction as the sole protection against credential output; application output may contain transformed secrets.

The accepted, implemented design in `docs/run-comparison-environment-files-design.md` defines parser and lifecycle details. Browser tests cover file selection, ordering, persistence of paths and safe missing-file errors. The Geist file browser was also checked with keyboard-accessible controls and an automated dialog accessibility scan (zero reported violations).

The previous generated Dockerfile copied the repository before deleting environment files. Deleting a copied file in a later layer does not remove it from earlier layers. The implementation now excludes environment files, selected credential paths, Git metadata and symlinks from source staging before image creation, and ignores repository Dockerfiles.

## Open design branches

Accepted scope: Instances only run development servers. Preparation installs dependencies; no production application build is offered or executed. Selected Environment Files must support credentials needed for dependency installation and development-server execution. This replaces the earlier ambiguous description of credentials for "image builds". Dependency installation receives only `NODE_AUTH_TOKEN` from the selected files; other imported variables are withheld from that stage. `NODE_AUTH_TOKEN` is withheld from development-server execution, which receives the remaining imported variables. Sauce Control owns the development container setup and ignores Repository Dockerfiles, superseding that part of ADR 0001.

- Credential delivery capability checks and runtime verification; unsupported protection must stop the run.
- Parsing and reserved-variable rules are resolved in the accepted design.

Record glossary terms when resolved and an ADR when a consequential trade-off is accepted.

Accepted comparison consistency: both Instances receive the same imported values, with the same stage restrictions. `NODE_AUTH_TOKEN` is available only during dependency installation; the remaining imported variables are supplied to both development servers. There are no branch-specific overrides.

Accepted retention: remember selected Environment File paths per Repository and read their current contents for each Comparison run. Do not persist file contents or parsed values in Sauce Control settings. Temporary delivery resources and any runtime-owned secret storage still need a defined lifetime and cleanup policy.

Accepted file precedence: process Environment Files in their displayed list order. When multiple files define the same variable, the last file wins. Preserve this order with the remembered paths.

Accepted keychain precedence: start with previously saved Repository variables from the keychain, then overlay the selected Environment Files in order. File values override saved variables with the same name. Apply the installation-only restriction for `NODE_AUTH_TOKEN` to the final merged values, regardless of their source. Imported file values are not written back to the keychain.

Accepted validation: a missing, unreadable or malformed selected Environment File stops Run Comparison before either Instance starts. Errors identify the file and, when applicable, the line number, without including variable values or raw source lines. Validate all selected files before starting dependency installation or either development server.

Accepted parsing: support `KEY=value`, quoted values, comments and blank lines. Quoted values may span multiple lines, preserving literal line breaks and contents, including private keys. Values are literal: do not interpolate variable references such as `$OTHER_VAR`, decode escapes or execute command substitutions such as `$(command)`. Parse file contents as data; never source them in a shell. Do not display multiline values. Outside quotes, a hash preceded by whitespace begins a comment; hashes inside quoted values are literal.

Accepted runtime compatibility: if the selected Docker or Podman installation cannot deliver credentials with the agreed protections, stop Run Comparison with runtime-support guidance. Do not silently fall back to a weaker delivery method. The implementation probes the launcher with a synthetic canary before sending credentials. Live Docker verification passed; live Podman verification remains outstanding.

Accepted file-selection interface: provide a local file browser inside Sauce Control alongside editable file paths. Support multiple selected files and ordering. Follow the [Geist design system](https://vercel.com/geist/introduction), including its component and accessibility guidance, not just its fonts. The current application already configures Geist Sans and Geist Mono in `src/app/layout.tsx`; reuse those fonts, with Sans for controls and Mono for paths and variable names. Display file metadata and paths without previewing credential values. Users may select files outside the configured Code Directory, subject to the local process's filesystem permissions; selecting files does not require a configured Code Directory.

Accepted development command discovery: read `package.json`, prefer `scripts.dev`, then `scripts.develop`, and use `packageManager` to select the package manager. The usual commands are `pnpm dev` and `pnpm develop`. Require an explicit development-server command only when neither script exists; never automatically fall back to `start`. This changes the existing `dev`/`start` discovery order.
