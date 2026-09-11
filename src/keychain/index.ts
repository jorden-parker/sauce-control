import { createKeychain } from "./keychain";
import { memoryKeychainAdapter } from "./memory-keychain-adapter";
import { osKeychainAdapter } from "./os-keychain-adapter";

/** Secrets stored in the operating system keychain under the sauce-control service. */
export const keychain = createKeychain(
  process.env.SAUCE_CONTROL_KEYCHAIN === "memory"
    ? memoryKeychainAdapter()
    : osKeychainAdapter
);
