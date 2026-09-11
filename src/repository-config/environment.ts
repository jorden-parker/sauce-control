import type { Keychain } from "@/keychain/keychain";

const LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u,
  unquote = (value: string): string => {
    const trimmed = value.trim();
    return (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;
  };

/** Parses dotenv-style text into variables; lines that are not `KEY=value` are ignored. */
export const parseEnvironment = (text: string): Record<string, string> => {
  const variables: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = LINE.exec(line.trim());
    if (match && !line.trim().startsWith("#")) {
      variables[match[1]!] = unquote(match[2]!);
    }
  }
  return variables;
};

export const environmentSecret = (repository: string): string =>
  `environment:${repository}`;

/** Variables pasted for one Repository, from the keychain only. */
export const loadEnvironment = (
  keychain: Keychain,
  repository: string
): Record<string, string> => {
  const stored = keychain.getSecret(environmentSecret(repository));
  return stored === undefined
    ? {}
    : (JSON.parse(stored) as Record<string, string>);
};

export const saveEnvironment = (
  keychain: Keychain,
  repository: string,
  variables: Record<string, string>
): void => {
  keychain.setSecret(environmentSecret(repository), JSON.stringify(variables));
};
