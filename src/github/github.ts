import { keychain } from "@/keychain";
import { ghCli } from "./gh-cli";
import { type GitHubClient, createGitHubClient } from "./github-client";
import { type GitHubToken, resolveGitHubToken } from "./github-token";
import { gitHubRequestLog, loggingFetch } from "./request-log";
import { stubGitHubClient } from "./stub-github-client";

const useStub = (): boolean => process.env.SAUCE_CONTROL_GITHUB === "stub";

/** Where the current credential comes from, for the Settings page. Never the token itself. */
export const gitHubTokenSource = async (): Promise<
  GitHubToken["source"] | undefined
> => {
  if (useStub()) {
    return "gh";
  }
  return (await resolveGitHubToken(ghCli, keychain))?.source;
};

/** The raw token for git clones, or undefined when the reviewer has none. Never shown. */
export const gitHubToken = async (): Promise<string | undefined> => {
  if (useStub()) {
    return "stub-token";
  }
  return (await resolveGitHubToken(ghCli, keychain))?.token;
};

/**
 * A client for the current credential, or undefined when the reviewer has none. Every request it
 * makes is logged under `caller`, so the log says which feature asked.
 */
export const gitHubClient = async (
  caller: string
): Promise<GitHubClient | undefined> => {
  if (useStub()) {
    return stubGitHubClient;
  }
  const token = await resolveGitHubToken(ghCli, keychain);
  return token === undefined
    ? undefined
    : createGitHubClient(
        loggingFetch(fetch, gitHubRequestLog(), caller),
        token.token
      );
};
