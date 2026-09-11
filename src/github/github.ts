import { keychain } from "@/keychain";
import { ghCli } from "./gh-cli";
import { type GitHubClient, createGitHubClient } from "./github-client";
import { type GitHubToken, resolveGitHubToken } from "./github-token";
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

/** A client for the current credential, or undefined when the reviewer has none. */
export const gitHubClient = async (): Promise<GitHubClient | undefined> => {
  if (useStub()) {
    return stubGitHubClient;
  }
  const token = await resolveGitHubToken(ghCli, keychain);
  return token === undefined
    ? undefined
    : createGitHubClient(fetch, token.token);
};
