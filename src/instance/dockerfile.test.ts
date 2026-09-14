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
    expect(generateDockerfile()).not.toContain("pnpm run dev");
  });

  it("installs at build time behind a secret mount only when a token is supplied", () => {
    expect(generateDockerfile()).not.toContain("pnpm install");
    expect(generateDockerfile()).not.toContain("--mount=type=secret");
    const dockerfile = generateDockerfile(undefined, { registryAuth: true });
    expect(dockerfile).toContain(
      "RUN --mount=type=secret,id=NODE_AUTH_TOKEN,required=true,uid=1000"
    );
    expect(dockerfile).toContain(
      "--mount=type=secret,id=NPM_REGISTRY,uid=1000"
    );
    expect(dockerfile).toContain(
      'NODE_AUTH_TOKEN="$(cat /run/secrets/NODE_AUTH_TOKEN)" && \\'
    );
    expect(dockerfile).toContain(
      'REGISTRY="$(cat /run/secrets/NPM_REGISTRY 2>/dev/null || pnpm config get registry)" && \\'
    );
    expect(dockerfile).toContain('npm_config_registry="${REGISTRY}"');
    expect(dockerfile).toContain(
      'pnpm_config__auth="{\\"${REGISTRY}\\":{\\"@\\":{\\"authToken\\":\\"${NODE_AUTH_TOKEN}\\"}}}"'
    );
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile.indexOf("USER node")).toBeLessThan(
      dockerfile.indexOf("RUN --mount=type=secret")
    );
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
