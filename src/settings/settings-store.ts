import { DatabaseSync } from "node:sqlite";
import {
  type RuntimeName,
  isRuntimeName,
} from "@/container-runtime/runtime-status";

/** The start of a Comparison: one Repository and its two branches. */
export interface ComparisonSelection {
  baseBranch: string;
  repository: string;
  targetBranch: string;
}

/** How one Repository is built and started, saved once and reused for every Comparison of it. */
export interface RepositoryConfig {
  buildCommand: string;
  port: number;
  startCommand: string;
  /** Explicit opt-in to the clone's `.env.local` instead of keychain variables only. */
  useDotEnvLocal: boolean;
}

export interface SettingsStore {
  close: () => void;
  getCodeDirectory: () => string | undefined;
  getComparisonSelection: () => ComparisonSelection | undefined;
  getContainerRuntime: () => RuntimeName | undefined;
  getOrganisation: () => string | undefined;
  getRepositoryConfig: (repository: string) => RepositoryConfig | undefined;
  saveCodeDirectory: (directory: string) => void;
  saveComparisonSelection: (selection: ComparisonSelection) => void;
  saveContainerRuntime: (runtime: RuntimeName) => void;
  saveOrganisation: (organisation: string) => void;
  saveRepositoryConfig: (repository: string, config: RepositoryConfig) => void;
}

const CODE_DIRECTORY_KEY = "code-directory",
  COMPARISON_SELECTION_KEY = "comparison-selection",
  CONTAINER_RUNTIME_KEY = "container-runtime",
  ORGANISATION_KEY = "organisation",
  repositoryConfigKey = (repository: string): string =>
    `repository-config:${repository}`,
  isRepositoryConfig = (value: unknown): value is RepositoryConfig =>
    typeof value === "object" &&
    value !== null &&
    "buildCommand" in value &&
    "port" in value &&
    "startCommand" in value &&
    "useDotEnvLocal" in value,
  isSelection = (value: unknown): value is ComparisonSelection =>
    typeof value === "object" &&
    value !== null &&
    "baseBranch" in value &&
    "repository" in value &&
    "targetBranch" in value;

export const openSettingsStore = (databasePath: string): SettingsStore => {
  const database = new DatabaseSync(databasePath);
  database.exec(
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
  );
  const select = database.prepare("SELECT value FROM settings WHERE key = ?"),
    upsert = database.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ),
    read = (key: string): string | undefined =>
      (select.get(key) as { value: string } | undefined)?.value;

  return {
    close: () => {
      database.close();
    },
    getCodeDirectory: () => read(CODE_DIRECTORY_KEY),
    getComparisonSelection: () => {
      const value = read(COMPARISON_SELECTION_KEY);
      if (value === undefined) {
        return;
      }
      const parsed: unknown = JSON.parse(value);
      return isSelection(parsed) ? parsed : undefined;
    },
    getContainerRuntime: () => {
      const value = read(CONTAINER_RUNTIME_KEY);
      return value !== undefined && isRuntimeName(value) ? value : undefined;
    },
    getOrganisation: () => read(ORGANISATION_KEY),
    getRepositoryConfig: (repository) => {
      const value = read(repositoryConfigKey(repository));
      if (value === undefined) {
        return;
      }
      const parsed: unknown = JSON.parse(value);
      return isRepositoryConfig(parsed) ? parsed : undefined;
    },
    saveCodeDirectory: (directory) => {
      upsert.run(CODE_DIRECTORY_KEY, directory);
    },
    saveComparisonSelection: (selection) => {
      upsert.run(COMPARISON_SELECTION_KEY, JSON.stringify(selection));
    },
    saveContainerRuntime: (runtime) => {
      upsert.run(CONTAINER_RUNTIME_KEY, runtime);
    },
    saveOrganisation: (organisation) => {
      upsert.run(ORGANISATION_KEY, organisation);
    },
    saveRepositoryConfig: (repository, config) => {
      upsert.run(repositoryConfigKey(repository), JSON.stringify(config));
    },
  };
};
