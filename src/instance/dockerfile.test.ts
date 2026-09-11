import { describe, expect, it } from "vitest";
import { generateDockerfile } from "./dockerfile";

describe("generated Dockerfile", () => {
  it("uses only the trusted launcher, never configured commands in image layers", () => {
    expect(
      generateDockerfile({
        installCommand: "pnpm install --frozen-lockfile",
        port: 4000,
        startCommand: "pnpm run dev",
        useDotEnvLocal: false,
      })
    ).toContain('CMD ["node", "/opt/sauce-control-launcher.cjs"]');
    expect(generateDockerfile()).not.toContain("pnpm install");
    expect(generateDockerfile()).not.toContain("pnpm run dev");
  });

  it("never copies the entire clone or uses the legacy environment opt-in", () => {
    const dockerfile = generateDockerfile({
      installCommand: "npm install",
      port: 3000,
      startCommand: "npm run dev",
      useDotEnvLocal: true,
    });
    expect(dockerfile).not.toContain("rm -f .env");
    expect(dockerfile).not.toContain("COPY . .");
  });
});
