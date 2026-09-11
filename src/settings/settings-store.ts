import { DatabaseSync } from "node:sqlite";

export interface SettingsStore {
  close: () => void;
  getOrganisation: () => string | undefined;
  saveOrganisation: (organisation: string) => void;
}

const ORGANISATION_KEY = "organisation";

export const openSettingsStore = (databasePath: string): SettingsStore => {
  const database = new DatabaseSync(databasePath);
  database.exec(
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
  );
  const select = database.prepare("SELECT value FROM settings WHERE key = ?"),
    upsert = database.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );

  return {
    close: () => {
      database.close();
    },
    getOrganisation: () => {
      const row = select.get(ORGANISATION_KEY) as { value: string } | undefined;
      return row?.value;
    },
    saveOrganisation: (organisation) => {
      upsert.run(ORGANISATION_KEY, organisation);
    },
  };
};
