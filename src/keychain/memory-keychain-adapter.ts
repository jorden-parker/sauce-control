import type { KeychainAdapter } from "./keychain";

/** Process-memory keychain for the Playwright suite (SAUCE_CONTROL_KEYCHAIN=memory); nothing touches the OS keychain. */
const key = (service: string, account: string): string =>
  `${service}/${account}`;

export const memoryKeychainAdapter = (): KeychainAdapter => {
  const secrets = new Map<string, string>();
  return {
    deletePassword: (service, account) => secrets.delete(key(service, account)),
    getPassword: (service, account) =>
      secrets.get(key(service, account)) ?? null,
    setPassword: (service, account, password) => {
      secrets.set(key(service, account), password);
    },
  };
};
