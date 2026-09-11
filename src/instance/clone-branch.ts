import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GitHubRequestLog } from "@/github/request-log";
import type { CommandRunner } from "@/shell/command-runner";

export interface CloneRequest {
  branch: string;
  /** Optional local folder of checkouts; a matching one speeds up the clone. */
  codeDirectory?: string | undefined;
  destination: string;
  organisation: string;
  repository: string;
  token: string;
}

const CLONE_TIMEOUT_MS = 10 * 60 * 1000,
  referenceCheckout = ({
    codeDirectory,
    repository,
  }: CloneRequest): string | undefined => {
    if (codeDirectory === undefined) {
      return;
    }
    const checkout = join(codeDirectory, repository);
    return existsSync(join(checkout, ".git")) ? checkout : undefined;
  },
  redact = (text: string, token: string): string =>
    text.split(token).join("<token>");

/**
 * Clones one branch of a Repository over HTTPS into `destination`, using the Code Directory checkout
 * as a reference when present. The transfer is recorded in the GitHub request log when one is given.
 */
export const cloneBranch = async (
  git: CommandRunner,
  request: CloneRequest,
  requestLog?: GitHubRequestLog
): Promise<void> => {
  const { branch, destination, organisation, repository, token } = request,
    reference = referenceCheckout(request),
    url = `https://x-access-token:${token}@github.com/${organisation}/${repository}.git`,
    startedAt = Date.now(),
    record = (status: "ok" | "failed") => {
      requestLog?.record({
        caller: "clone-branch",
        durationMs: Date.now() - startedAt,
        kind: "git",
        method: "clone",
        path: `/${organisation}/${repository}.git#${branch}`,
        status,
        timestamp: new Date(startedAt).toISOString(),
      });
    };
  try {
    await git.run(
      "git",
      [
        "clone",
        "--filter=blob:none",
        "--single-branch",
        "--branch",
        branch,
        ...(reference === undefined ? [] : ["--reference", reference]),
        url,
        destination,
      ],
      { timeoutMs: CLONE_TIMEOUT_MS }
    );
    record("ok");
  } catch (error) {
    record("failed");
    const detail = error instanceof Error ? error.message : String(error);
    // The original error carries the token in its URL, so it is redacted rather than attached as the cause.
    // oxlint-disable-next-line preserve-caught-error
    throw new Error(
      `Could not clone ${repository} ${branch}: ${redact(detail, token)}`
    );
  }
};
