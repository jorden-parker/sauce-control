import { DatabaseSync } from "node:sqlite";
import {
  type RuntimeName,
  isRuntimeName,
} from "@/container-runtime/runtime-status";

export interface SettingsStore {
  close: () => void;
  getContainerRuntime: () => RuntimeName | undefined;
  getOrganisation: () => string | undefined;
  saveContainerRuntime: (runtime: RuntimeName) => void;
  saveOrganisation: (organisation: string) => void;
}

const CONTAINER_RUNTIME_KEY = "container-runtime",
  ORGANISATION_KEY = "organisation";

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
    getContainerRuntime: () => {
      const value = read(CONTAINER_RUNTIME_KEY);
      return value !== undefined && isRuntimeName(value) ? value : undefined;
    },
    getOrganisation: () => read(ORGANISATION_KEY),
    saveContainerRuntime: (runtime) => {
      upsert.run(CONTAINER_RUNTIME_KEY, runtime);
    },
    saveOrganisation: (organisation) => {
      upsert.run(ORGANISATION_KEY, organisation);
    },
  };
};
