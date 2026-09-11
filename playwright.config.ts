import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = 3417,
  dataDirectory = mkdtempSync(join(tmpdir(), "sauce-control-e2e-"));

/** Runs the app against the stub GitHub client and a throwaway data directory. */
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: `pnpm next dev -H 127.0.0.1 -p ${PORT}`,
    env: {
      SAUCE_CONTROL_DATA_DIR: dataDirectory,
      SAUCE_CONTROL_DIST_DIR: ".next-e2e",
      SAUCE_CONTROL_GITHUB: "stub",
    },
    reuseExistingServer: false,
    url: `http://127.0.0.1:${PORT}/settings`,
  },
});
