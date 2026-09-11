import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = 3417,
  dataDirectory = mkdtempSync(join(tmpdir(), "sauce-control-e2e-"));

/**
 * Runs the app against the stub GitHub client and a throwaway data directory. One worker:
 * the app runs one Comparison at a time, so files that start one cannot share the server.
 */
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: `pnpm next dev -H 127.0.0.1 -p ${PORT}`,
    env: {
      // Instance cleanup owns the exit; see src/instance/session-bootstrap.ts.
      NEXT_EXIT_TIMEOUT_MS: "90000",
      NEXT_MANUAL_SIG_HANDLE: "true",
      SAUCE_CONTROL_APP_LABEL: "sauce-control-e2e",
      SAUCE_CONTROL_COMPARISON: "stub",
      SAUCE_CONTROL_DATA_DIR: dataDirectory,
      SAUCE_CONTROL_DIST_DIR: ".next-e2e",
      SAUCE_CONTROL_GITHUB: "stub",
      SAUCE_CONTROL_KEYCHAIN: "memory",
    },
    reuseExistingServer: false,
    stderr: "ignore",
    stdout: "ignore",
    url: `http://127.0.0.1:${PORT}/settings`,
  },
  workers: 1,
});
