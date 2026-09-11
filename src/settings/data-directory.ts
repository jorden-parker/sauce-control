import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Directory holding local state. Override with SAUCE_CONTROL_DATA_DIR. */
export const dataDirectory = (): string => {
  const directory =
    process.env.SAUCE_CONTROL_DATA_DIR ?? join(homedir(), ".sauce-control");
  mkdirSync(directory, { recursive: true });
  return directory;
};

export const settingsDatabasePath = (): string =>
  join(dataDirectory(), "settings.db");

export const gitHubRequestsDatabasePath = (): string =>
  join(dataDirectory(), "github-requests.db");

export const endpointRecordingsDatabasePath = (): string =>
  join(dataDirectory(), "endpoint-recordings.db");
