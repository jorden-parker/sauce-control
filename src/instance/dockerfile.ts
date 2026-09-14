/**
 * Registry authentication for the build-time install. The registry URL comes
 * from the optional `NPM_REGISTRY` build secret (an ordinary Repository
 * environment variable on the host), else from the Repository's own `.npmrc`
 * via `pnpm config get registry`. No organisation-specific URL lives in this
 * source; the token arrives only through the `NODE_AUTH_TOKEN` secret mount and
 * neither value enters an image layer.
 */
const REGISTRY_AUTH_INSTALL = [
  "RUN --mount=type=secret,id=NODE_AUTH_TOKEN,required=true,uid=1000 \\",
  "    --mount=type=secret,id=NPM_REGISTRY,uid=1000 \\",
  // Assignments are separate commands: `A=x B=y cmd` expands $A before assigning it.
  '    NODE_AUTH_TOKEN="$(cat /run/secrets/NODE_AUTH_TOKEN)" && \\',
  '    REGISTRY="$(cat /run/secrets/NPM_REGISTRY 2>/dev/null || pnpm config get registry)" && \\',
  '    env npm_config_registry="${REGISTRY}" \\',
  '    pnpm_config__auth="{\\"${REGISTRY}\\":{\\"@\\":{\\"authToken\\":\\"${NODE_AUTH_TOKEN}\\"}}}" \\',
  "    pnpm install --frozen-lockfile",
].join("\n");

export interface DockerfileOptions {
  /** Install at build time behind the secret mounts; only for pnpm Repositories given NODE_AUTH_TOKEN. */
  registryAuth?: boolean;
}

/** No repository commands or credentials enter image layers. */
export const generateDockerfile = (
  _config?: unknown,
  { registryAuth = false }: DockerfileOptions = {}
): string =>
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
    ...(registryAuth ? [REGISTRY_AUTH_INSTALL] : []),
    'CMD ["node", "/opt/sauce-control-launcher.cjs"]',
    "",
  ].join("\n");
