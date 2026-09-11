import { describe, expect, it } from "vitest";
import type { Keychain } from "@/keychain/keychain";
import { type GhCli, resolveGitHubToken } from "./github-token";

const fakeKeychain = (entries: Record<string, string> = {}): Keychain => {
    const store = new Map(Object.entries(entries));
    return {
      deleteSecret: (name) => {
        store.delete(name);
      },
      getSecret: (name) => store.get(name),
      setSecret: (name, secret) => {
        store.set(name, secret);
      },
    };
  },
  ghWithToken = (token: string): GhCli => ({
    authToken: () => Promise.resolve(token),
  });

describe("GitHub token source", () => {
  it("uses the gh CLI token when gh is logged in", async () => {
    const token = await resolveGitHubToken(
      ghWithToken("gho_from_gh"),
      fakeKeychain({ "github-token": "ghp_from_keychain" })
    );
    expect(token).toEqual({ source: "gh", token: "gho_from_gh" });
  });
});

const ghLoggedOut: GhCli = {
  authToken: () => Promise.reject(new Error("gh: not logged in")),
};

describe("GitHub token source without gh", () => {
  it("falls back to the personal access token in the keychain", async () => {
    const token = await resolveGitHubToken(
      ghLoggedOut,
      fakeKeychain({ "github-token": "ghp_from_keychain" })
    );
    expect(token).toEqual({ source: "keychain", token: "ghp_from_keychain" });
  });

  it("has no token when gh is logged out and nothing is pasted", async () => {
    const token = await resolveGitHubToken(ghLoggedOut, fakeKeychain());
    expect(token).toBeUndefined();
  });
});
