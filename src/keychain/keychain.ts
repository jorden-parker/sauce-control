export interface KeychainAdapter {
  deletePassword: (service: string, account: string) => boolean;
  getPassword: (service: string, account: string) => string | null;
  setPassword: (service: string, account: string, password: string) => void;
}

export interface Keychain {
  deleteSecret: (name: string) => void;
  getSecret: (name: string) => string | undefined;
  setSecret: (name: string, secret: string) => void;
}

const SERVICE = "sauce-control";

export const createKeychain = (adapter: KeychainAdapter): Keychain => ({
  deleteSecret: (name) => {
    adapter.deletePassword(SERVICE, name);
  },
  getSecret: (name) => adapter.getPassword(SERVICE, name) ?? undefined,
  setSecret: (name, secret) => {
    adapter.setPassword(SERVICE, name, secret);
  },
});
