import { createKeychain } from "./keychain";
import { osKeychainAdapter } from "./os-keychain-adapter";

/** Secrets stored in the operating system keychain under the sauce-control service. */
export const keychain = createKeychain(osKeychainAdapter);
