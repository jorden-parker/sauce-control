import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GhCli } from "./github-token";

const execFileAsync = promisify(execFile),
  TIMEOUT_MS = 10_000;

/** The real `gh` binary. Rejects when gh is absent or logged out. */
export const ghCli: GhCli = {
  authToken: async () => {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], {
      timeout: TIMEOUT_MS,
    });
    return stdout.trim();
  },
};
