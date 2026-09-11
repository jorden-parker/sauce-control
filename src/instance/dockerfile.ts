import type { RepositoryConfig } from "@/settings/settings-store";

const BASE_IMAGE = "node:22-bookworm-slim",
  escapeForJson = (command: string): string => JSON.stringify(command);

/** A Dockerfile for a Repository without one, from its configured commands. */
export const generateDockerfile = ({
  buildCommand,
  port,
  startCommand,
  useDotEnvLocal,
}: RepositoryConfig): string =>
  [
    `FROM ${BASE_IMAGE}`,
    "WORKDIR /app",
    "COPY . .",
    ...(useDotEnvLocal ? [] : ["RUN rm -f .env .env.local .env.*.local"]),
    ...(buildCommand.trim() === ""
      ? ["RUN corepack enable"]
      : [`RUN corepack enable && ${buildCommand}`]),
    `ENV PORT=${port}`,
    `EXPOSE ${port}`,
    `CMD ["sh", "-c", ${escapeForJson(startCommand)}]`,
    "",
  ].join("\n");
