import { type SettingsStore, openSettingsStore } from "./settings-store";
import { settingsDatabasePath } from "./data-directory";

let store: SettingsStore | undefined;

/** Process-wide settings store, opened lazily on first use. */
export const settings = (): SettingsStore => {
  store ??= openSettingsStore(settingsDatabasePath());
  return store;
};
