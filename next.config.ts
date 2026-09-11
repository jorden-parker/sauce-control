import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** The Playwright suite builds into its own directory so it can run beside a developer's `next dev`. */
  distDir: process.env.SAUCE_CONTROL_DIST_DIR ?? ".next",
  serverExternalPackages: ["@napi-rs/keyring"],
};

export default nextConfig;
