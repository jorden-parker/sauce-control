import type { SchemaSource } from "@/scenarios/schema-sources";
import type { ManualScenario } from "@/scenarios/scenarios";
import { DatabaseSync } from "node:sqlite";
import {
  type RuntimeName,
  isRuntimeName,
} from "@/container-runtime/runtime-status";
import { type CrawlLimits, DEFAULT_CRAWL_LIMITS } from "@/crawler/crawl-limits";

/** The start of a Comparison: one Repository and its two branches. */
export interface ComparisonSelection {
  baseBranch: string;
  repository: string;
  targetBranch: string;
}

export interface ManualPages {
  added: string[];
  removed: string[];
}

export const DEFAULT_MANUAL_PAGES: ManualPages = { added: [], removed: [] };

/** Dependency installation and development-server configuration for a Repository. */
export interface RepositoryConfig {
  /** Legacy setup retained for migration to the app-wide setting. */
  environmentSetupCommand?: string;
  installCommand: string;
  crawl: CrawlLimits;
  /** Pages the reviewer added or removed by hand, on top of what discovery finds. */
  pages: ManualPages;
  port: number;
  startCommand: string;
  /** Legacy setting retained for reading old configurations; never used by execution. */
  useDotEnvLocal?: boolean;
}

export interface ScenarioConfig {
  schemaSources: SchemaSource[];
  manualScenarios: ManualScenario[];
}

export interface SettingsStore {
  getEnvironmentSetup: () => EnvironmentSetup;
  saveEnvironmentSetupCommand: (command: string) => void;
  savePackageRegistry: (registry: string) => void;
  getScenarioConfig: (repository: string) => ScenarioConfig;
  saveScenarioConfig: (repository: string, config: ScenarioConfig) => void;
  close: () => void;
  getCodeDirectory: () => string | undefined;
  getComparisonSelection: () => ComparisonSelection | undefined;
  getContainerRuntime: () => RuntimeName | undefined;
  getOrganisation: () => string | undefined;
  getRepositoryConfig: (repository: string) => RepositoryConfig | undefined;
  getEnvironmentFiles: (repository: string) => string[];
  saveEnvironmentFiles: (repository: string, paths: string[]) => void;
  saveCodeDirectory: (directory: string) => void;
  saveComparisonSelection: (selection: ComparisonSelection) => void;
  saveContainerRuntime: (runtime: RuntimeName) => void;
  saveOrganisation: (organisation: string) => void;
  saveRepositoryConfig: (repository: string, config: RepositoryConfig) => void;
}

export interface EnvironmentSetup {
  command: string;
  conflicts: { repository: string; command: string }[];
  /** Package registry URL mounted into dependency installation as `NPM_REGISTRY`; empty means the Repository's own `.npmrc`. */
  registry: string;
}

const CODE_DIRECTORY_KEY = "code-directory",
  COMPARISON_SELECTION_KEY = "comparison-selection",
  CONTAINER_RUNTIME_KEY = "container-runtime",
  ORGANISATION_KEY = "organisation",
  PACKAGE_REGISTRY_KEY = "package-registry",
  repositoryConfigKey = (repository: string): string =>
    `repository-config:${repository}`,
  /** Configs saved before crawl limits and manual Pages existed get the defaults on read. */
  isRepositoryConfig = (
    value: unknown
  ): value is Omit<RepositoryConfig, "crawl" | "pages"> &
    Partial<Pick<RepositoryConfig, "crawl" | "pages">> =>
    typeof value === "object" &&
    value !== null &&
    ("installCommand" in value || "buildCommand" in value) &&
    "port" in value &&
    "startCommand" in value,
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
    getEnvironmentFiles: (repository) => {
      const value = read(`environment-files:${repository}`);
      if (value === undefined) {
        return [];
      }
      const paths: unknown = JSON.parse(value);
      return Array.isArray(paths) &&
        paths.every((path) => typeof path === "string")
        ? paths
        : [];
    },
    getEnvironmentSetup: () => {
      const saved = read("environment-setup-command"),
        registry = read(PACKAGE_REGISTRY_KEY) ?? "";
      if (saved !== undefined) {
        return { command: saved, conflicts: [], registry };
      }
      const legacy: EnvironmentSetup["conflicts"] = [];
      for (const row of database
        .prepare(
          "SELECT key, value FROM settings WHERE key LIKE 'repository-config:%' ORDER BY key"
        )
        .all()) {
        const config: unknown = JSON.parse(String(row.value));
        if (
          isRepositoryConfig(config) &&
          typeof config.environmentSetupCommand === "string" &&
          config.environmentSetupCommand.trim()
        ) {
          legacy.push({
            command: config.environmentSetupCommand.trim(),
            repository: String(row.key).slice("repository-config:".length),
          });
        }
      }
      const commands = new Set(legacy.map(({ command }) => command));
      if (commands.size > 1) {
        return { command: "", conflicts: legacy, registry };
      }
      const command = [...commands][0] ?? "";
      upsert.run("environment-setup-command", command);
      return { command, conflicts: [], registry };
    },
    getOrganisation: () => read(ORGANISATION_KEY),
    getRepositoryConfig: (repository) => {
      const value = read(repositoryConfigKey(repository));
      if (value === undefined) {
        return;
      }
      const parsed: unknown = JSON.parse(value);
      return isRepositoryConfig(parsed)
        ? {
            crawl: DEFAULT_CRAWL_LIMITS,
            pages: DEFAULT_MANUAL_PAGES,
            ...parsed,
            installCommand:
              "installCommand" in parsed ? parsed.installCommand : "",
          }
        : undefined;
    },
    getScenarioConfig: (repository) => {
      const value = read(`scenarios:${repository}`);
      return value === undefined
        ? { manualScenarios: [], schemaSources: [] }
        : (JSON.parse(value) as ScenarioConfig);
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
    saveEnvironmentFiles: (repository, paths) => {
      upsert.run(`environment-files:${repository}`, JSON.stringify(paths));
    },
    saveEnvironmentSetupCommand: (command) => {
      upsert.run("environment-setup-command", command);
    },
    saveOrganisation: (organisation) => {
      upsert.run(ORGANISATION_KEY, organisation);
    },
    savePackageRegistry: (registry) => {
      upsert.run(PACKAGE_REGISTRY_KEY, registry);
    },
    saveRepositoryConfig: (repository, config) => {
      upsert.run(repositoryConfigKey(repository), JSON.stringify(config));
    },
    saveScenarioConfig: (repository, config) => {
      upsert.run(`scenarios:${repository}`, JSON.stringify(config));
    },
  };
};
