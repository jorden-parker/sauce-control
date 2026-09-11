import { describe, expect, it } from "vitest";
import { type KeychainAdapter, createKeychain } from "./keychain";

const fakeAdapter = (): KeychainAdapter => {
  const entries = new Map<string, string>();
  return {
    deletePassword: (service, account) =>
      entries.delete(`${service}:${account}`),
    getPassword: (service, account) =>
      entries.get(`${service}:${account}`) ?? null,
    setPassword: (service, account, password) => {
      entries.set(`${service}:${account}`, password);
    },
  };
};

describe("keychain", () => {
  it("has no secret before one is stored", () => {
    const keychain = createKeychain(fakeAdapter());
    expect(keychain.getSecret("github-token")).toBeUndefined();
  });

  it("returns a stored secret", () => {
    const keychain = createKeychain(fakeAdapter());
    keychain.setSecret("github-token", "ghp_abc123");
    expect(keychain.getSecret("github-token")).toBe("ghp_abc123");
  });

  it("forgets a deleted secret", () => {
    const keychain = createKeychain(fakeAdapter());
    keychain.setSecret("github-token", "ghp_abc123");
    keychain.deleteSecret("github-token");
    expect(keychain.getSecret("github-token")).toBeUndefined();
  });

  it("stores every secret under the sauce-control service", () => {
    const adapter = fakeAdapter();
    createKeychain(adapter).setSecret("github-token", "ghp_abc123");
    expect(adapter.getPassword("sauce-control", "github-token")).toBe(
      "ghp_abc123"
    );
  });
});
