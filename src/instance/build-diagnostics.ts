import { INSTALLATION_ERROR_HINTS } from "./installation-diagnostics";

/** Only fixed messages cross the build-output boundary; raw text never reaches the UI. */
const GENERIC =
    "Could not prepare the development container. Check Container Runtime in Settings and the network connection.",
  INSTALL_PREFIX =
    "Dependency installation failed during the image build. Raw logs are suppressed to protect credentials.",
  SECRETS_UNSUPPORTED =
    "The Container Runtime cannot build with secrets. Docker needs the buildx plugin (for example `brew install docker-buildx && docker buildx install`); Podman 4.2 or newer works as is. Then run a new Comparison.",
  SECRET_MISSING =
    "NODE_AUTH_TOKEN did not reach the image build. Export it from the Environment Setup Command or add it to a selected Environment File, then run a new Comparison.",
  stderrOf = (error: unknown): string =>
    typeof error === "object" && error !== null && "stderr" in error
      ? String(error.stderr)
      : "";

/** Classifies a failed `build` by fixed markers in its stderr; never quotes the output. */
export const buildFailureMessage = (error: unknown): string => {
  const stderr = stderrOf(error);
  if (
    /unknown flag: --secret|--secret.*(?:unknown|not supported)|buildx component is missing|the --mount option requires BuildKit|Dockerfile parse error.*--mount/iu.test(
      stderr
    )
  ) {
    return SECRETS_UNSUPPORTED;
  }
  if (
    /secret NODE_AUTH_TOKEN.*not found|secret not found: NODE_AUTH_TOKEN|no such secret.*NODE_AUTH_TOKEN|required secret.*NODE_AUTH_TOKEN/iu.test(
      stderr
    )
  ) {
    return SECRET_MISSING;
  }
  const code = Object.keys(INSTALLATION_ERROR_HINTS).find((key) =>
    new RegExp(String.raw`(?<![A-Z0-9_])${key}(?![A-Z0-9_])`, "u").test(stderr)
  );
  if (code !== undefined) {
    return `${INSTALL_PREFIX} ${code}: ${INSTALLATION_ERROR_HINTS[code]}`;
  }
  if (/pnpm install|ERR_PNPM|frozen-lockfile/u.test(stderr)) {
    return `${INSTALL_PREFIX} Check the Package registry URL and NODE_AUTH_TOKEN in Settings → Environment setup, and that the branch's pnpm lockfile is current.`;
  }
  return GENERIC;
};
