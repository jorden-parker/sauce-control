/** No repository commands or credentials enter image layers. */
export const generateDockerfile = (_config?: unknown): string =>
  [
    "FROM node:22-bookworm-slim",
    "RUN corepack enable",
    "WORKDIR /app",
    "COPY --chown=node:node source/ /app/",
    "COPY launcher.cjs /opt/sauce-control-launcher.cjs",
    // Installers update manifests and lockfiles even for an unchanged dependency
    // Graph. These are disposable copies; the checkout remains untouched.
    `RUN chown -R node:node /app && find /app -type f -exec chmod a-w {} + && ${String.raw`find /app -type f \( -name package.json -o -name package-lock.json -o `}-name npm-shrinkwrap.json -o -name pnpm-lock.yaml -o -name yarn.lock -o ${String.raw`-name bun.lock -o -name bun.lockb \) -exec chmod u+w {} +`}`,
    "USER node",
    'CMD ["node", "/opt/sauce-control-launcher.cjs"]',
    "",
  ].join("\n");
