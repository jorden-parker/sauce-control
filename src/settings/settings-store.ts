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

export interface SettingsStore {
  close: () => void;
  getComparisonSelection: () => ComparisonSelection | undefined;
  getContainerRuntime: () => RuntimeName | undefined;
  getOrganisation: () => string | undefined;
  saveComparisonSelection: (selection: ComparisonSelection) => void;
  saveContainerRuntime: (runtime: RuntimeName) => void;
  saveOrganisation: (organisation: string) => void;
}

const COMPARISON_SELECTION_KEY = "comparison-selection",
  CONTAINER_RUNTIME_KEY = "container-runtime",
  ORGANISATION_KEY = "organisation",
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
    saveComparisonSelection: (selection) => {
      upsert.run(COMPARISON_SELECTION_KEY, JSON.stringify(selection));
    },
    saveContainerRuntime: (runtime) => {
      upsert.run(CONTAINER_RUNTIME_KEY, runtime);
    },
    saveOrganisation: (organisation) => {
      upsert.run(ORGANISATION_KEY, organisation);
    },
  };
};
