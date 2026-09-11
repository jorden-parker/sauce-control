import { Entry } from "@napi-rs/keyring";
import type { KeychainAdapter } from "./keychain";

/** Adapter backed by the operating system keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service). */
export const osKeychainAdapter: KeychainAdapter = {
  deletePassword: (service, account) =>
    new Entry(service, account).deletePassword(),
  getPassword: (service, account) =>
    new Entry(service, account).getPassword() ?? null,
  setPassword: (service, account, password) => {
    new Entry(service, account).setPassword(password);
  },
};
