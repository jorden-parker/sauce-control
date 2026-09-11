import { describe, expect, it } from "vitest";
import { generateDockerfile } from "./dockerfile";

describe("generated Dockerfile", () => {
  it("builds with the configured commands, drops the clone's env files, and starts on the configured port", () => {
    expect(
      generateDockerfile({
        buildCommand: "pnpm install --frozen-lockfile",
        port: 4000,
        startCommand: "pnpm run dev",
        useDotEnvLocal: false,
      })
    ).toBe(`FROM node:22-bookworm-slim
WORKDIR /app
COPY . .
RUN rm -f .env .env.local .env.*.local
RUN corepack enable && pnpm install --frozen-lockfile
ENV PORT=4000
EXPOSE 4000
CMD ["sh", "-c", "pnpm run dev"]
`);
  });

  it("keeps .env.local only when the reviewer opted in", () => {
    const dockerfile = generateDockerfile({
      buildCommand: "npm install",
      port: 3000,
      startCommand: "npm run dev",
      useDotEnvLocal: true,
    });
    expect(dockerfile).not.toContain("rm -f .env");
  });
});
