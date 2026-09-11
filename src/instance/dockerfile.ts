/** No repository commands or credentials enter image layers. */
export const generateDockerfile = (_config?: unknown): string =>
  [
    "FROM node:22-bookworm-slim",
    "RUN corepack enable",
    "WORKDIR /app",
    "COPY --chown=node:node source/ /app/",
    "COPY launcher.cjs /opt/sauce-control-launcher.cjs",
    "RUN chown -R node:node /app && find /app -type f -exec chmod a-w {} +",
    "USER node",
    'CMD ["node", "/opt/sauce-control-launcher.cjs"]',
    "",
  ].join("\n");
