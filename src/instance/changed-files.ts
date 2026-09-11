import type { CommandRunner } from "@/shell/command-runner";

export interface ChangedFilesRequest {
  baseBranch: string;
  /** The Target Branch clone; the Base Branch is fetched into it so the merge base is known. */
  clonePath: string;
}

const FETCH_TIMEOUT_MS = 10 * 60 * 1000,
  DIFF_TIMEOUT_MS = 60 * 1000;

/**
 * Repository-relative paths of every file that differs between the Base Branch and the Target
 * Branch, measured from their merge base so commits landed on the Base Branch since do not count.
 * A rename counts as its old and its new path.
 */
export const changedFiles = async (
  git: CommandRunner,
  { baseBranch, clonePath }: ChangedFilesRequest
): Promise<string[]> => {
  const baseRef = `origin/${baseBranch}`;
  await git.run(
    "git",
    [
      "fetch",
      "--no-tags",
      "origin",
      `refs/heads/${baseBranch}:refs/remotes/${baseRef}`,
    ],
    { cwd: clonePath, timeoutMs: FETCH_TIMEOUT_MS }
  );
  const { stdout } = await git.run(
    "git",
    ["diff", "--name-only", "--no-renames", `${baseRef}...HEAD`],
    { cwd: clonePath, timeoutMs: DIFF_TIMEOUT_MS }
  );
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
};
