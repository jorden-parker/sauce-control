/** Only fixed codes and messages cross the installer-output boundary. */
const AUTH_HINT =
    "Check the repository's .npmrc or .yarnrc.yml authentication configuration and token access to its package registry. Supplying NODE_AUTH_TOKEN alone does not configure registry authentication.",
  LOCK_HINT =
    "Check that the branch's lockfile matches its package manifest and package-manager version.",
  MODULE_HINT =
    "A module could not be found. Check that the Dependency installation command installs everything the Development server command needs.",
  NETWORK_HINT =
    "Check network, DNS and proxy access from the Container Runtime to the package registry.",
  PERMISSION_HINT =
    "Check file permissions for the installer's files and cache inside the container.",
  TLS_HINT =
    "Check certificate trust inside the Container Runtime, including any company certificate authority.";

// More specific causes precede generic lifecycle failures in the launcher.
export const INSTALLATION_ERROR_HINTS: Record<string, string> = {
  CERT_HAS_EXPIRED: TLS_HINT,
  DEPTH_ZERO_SELF_SIGNED_CERT: TLS_HINT,
  E401: AUTH_HINT,
  E403: AUTH_HINT,
  E404: "Check the package registry configuration and package/version availability. Private registries may also return 404 when access is denied.",
  EACCES: PERMISSION_HINT,
  EADDRINUSE:
    "Something inside the container already uses the port. Open Compare → Configure repository and check Port against what the Development server command listens on.",
  EAI_AGAIN: NETWORK_HINT,
  EBADENGINE:
    "Check the repository's required Node.js and package-manager versions against the container.",
  ECONNREFUSED: NETWORK_HINT,
  ECONNRESET: NETWORK_HINT,
  ELIFECYCLE:
    "A package lifecycle script failed. Check the repository's installation scripts and their required tools.",
  ENEEDAUTH: AUTH_HINT,
  ENOSPC: "The container or its virtual machine ran out of disk space.",
  ENOTFOUND: NETWORK_HINT,
  EPERM: PERMISSION_HINT,
  ERESOLVE:
    "Resolve the dependency or peer-dependency conflict in the repository.",
  EROFS: PERMISSION_HINT,
  ERR_MODULE_NOT_FOUND: MODULE_HINT,
  ERR_PNPM_FETCH_401: AUTH_HINT,
  ERR_PNPM_FETCH_403: AUTH_HINT,
  ERR_PNPM_FETCH_404:
    "Check the package registry configuration, package/version availability and access to private packages.",
  ERR_PNPM_LOCKFILE_BREAKING_CHANGE: LOCK_HINT,
  ERR_PNPM_NO_LOCKFILE: LOCK_HINT,
  ERR_PNPM_OUTDATED_LOCKFILE: LOCK_HINT,
  ERR_PNPM_UNSUPPORTED_ENGINE:
    "Check the repository's required Node.js and package-manager versions against the container.",
  ETIMEDOUT: NETWORK_HINT,
  MODULE_NOT_FOUND: MODULE_HINT,
  SELF_SIGNED_CERT_IN_CHAIN: TLS_HINT,
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: TLS_HINT,
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: TLS_HINT,
  YN0028: LOCK_HINT,
  YN0033: AUTH_HINT,
  YN0041: AUTH_HINT,
};

/** Validate every field; never interpolate unrecognised installer or runtime text. */
export function installationFailureMessage(result: string): string | undefined {
  const match =
    /^installation-failed:([A-Z0-9_]+|unknown):(present|empty|absent):(\d{1,3}|signal|spawn)$/u.exec(
      result
    );
  if (!match || match[0] !== result) {
    return;
  }
  const [, code, token, status] = match;
  if (code !== "unknown" && !Object.hasOwn(INSTALLATION_ERROR_HINTS, code!)) {
    return;
  }
  if (/^\d/u.test(status!) && Number(status) > 255) {
    return;
  }
  const tokenMessage =
    token === "present"
      ? "A non-empty NODE_AUTH_TOKEN reached the installer; this does not confirm registry authentication."
      : token === "empty"
        ? "NODE_AUTH_TOKEN was empty. Check Environment File order; later values override earlier ones."
        : "NODE_AUTH_TOKEN was not supplied to the installer. Check the selected Environment Files if private packages require it.";
  const exitMessage =
    status === "signal"
      ? "The installer was terminated by a signal. Check the Container Runtime's resource limits."
      : status === "spawn"
        ? "The installer process could not be started."
        : `Installer exit code ${Number(status)}.`;
  const hint =
    code === "unknown"
      ? status === "127"
        ? "The shell could not find a required command. Check the installation command and the tools available in the container."
        : "No recognised error code was reported. Check the Dependency installation command and repository installation scripts."
      : `Installer reported ${code}. ${INSTALLATION_ERROR_HINTS[code!]}`;
  return `Dependency installation failed. ${exitMessage} ${tokenMessage} ${hint} Raw logs are suppressed to protect credentials.`;
}

/** Where the launcher records the development server's exit; only status and an allowlisted code. */
export const DEVELOPMENT_EXIT_PATH = "/home/node/.sauce-control-exit";

/** Validates the launcher's exit record; undefined for anything unrecognised. */
export function developmentExitMessage(record: string): string | undefined {
  const match = /^(\d{1,3}|signal):([A-Z0-9_]+|unknown)$/u.exec(record);
  if (!match) {
    return;
  }
  const [, status, code] = match;
  if (code !== "unknown" && !Object.hasOwn(INSTALLATION_ERROR_HINTS, code!)) {
    return;
  }
  if (/^\d/u.test(status!) && Number(status) > 255) {
    return;
  }
  const exitMessage =
      status === "signal"
        ? "The development server was terminated by a signal. Check the Container Runtime's resource limits."
        : `The development server exited with code ${Number(status)}.`,
    hint =
      code === "unknown"
        ? status === "127"
          ? "The shell could not find the command. Open Compare → Configure repository and check Development server command."
          : "No recognised error code was printed."
        : `It reported ${code}. ${INSTALLATION_ERROR_HINTS[code!]}`;
  return `${exitMessage} ${hint}`;
}
