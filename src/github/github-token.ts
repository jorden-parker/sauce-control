import type { Keychain } from "@/keychain/keychain";

/** The `gh` CLI, as far as this module needs it. */
export interface GhCli {
  /** Resolves the logged-in token; rejects when gh is absent or logged out. */
  authToken: () => Promise<string>;
}

export interface GitHubToken {
  source: "gh" | "keychain";
  token: string;
}

export const GITHUB_TOKEN_SECRET = "github-token";

/** Prefers the reviewer's existing gh login, falling back to a pasted PAT in the keychain. */
export const resolveGitHubToken = async (
  gh: GhCli,
  keychain: Keychain
): Promise<GitHubToken | undefined> => {
  try {
    const token = (await gh.authToken()).trim();
    if (token !== "") {
      return { source: "gh", token };
    }
  } catch {
    // Gh absent or logged out: fall through to the keychain.
  }
  const pasted = keychain.getSecret(GITHUB_TOKEN_SECRET);
  return pasted === undefined
    ? undefined
    : { source: "keychain", token: pasted };
};
