/** The parts of a package manifest that shape a Repository Config. */
export interface PackageManifest {
  packageManager?: string;
  scripts?: Record<string, string>;
}

export interface InferredConfig {
  installCommand: string;
  port: number;
  startCommand: string;
}

const DEFAULT_PORT = 3000,
  PORT_PATTERN = /(?:--port[= ]|-p |PORT=)(\d{2,5})/u,
  INSTALL_COMMANDS: Record<string, string> = {
    bun: "bun install --frozen-lockfile",
    npm: "npm install",
    pnpm: "pnpm install --frozen-lockfile",
    yarn: "yarn install --immutable",
  },
  packageManagerName = (manifest: PackageManifest): string =>
    manifest.packageManager?.split("@")[0] ?? "npm",
  startScript = (scripts: Record<string, string>): string | undefined =>
    ["dev", "develop"].find((name) => name in scripts);

/** Dependency installation and development commands inferred from package.json. */
export const inferRepositoryConfig = (
  manifest: PackageManifest
): InferredConfig => {
  const manager = packageManagerName(manifest),
    scripts = manifest.scripts ?? {},
    script = startScript(scripts),
    port = Number(
      PORT_PATTERN.exec(script ? (scripts[script] ?? "") : "")?.[1] ??
        DEFAULT_PORT
    );
  return {
    installCommand: INSTALL_COMMANDS[manager] ?? INSTALL_COMMANDS.npm!,
    port,
    startCommand: script ? `${manager} run ${script}` : "",
  };
};

const SCRIPT_ALIAS = /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:-]+)$/u,
  PRODUCTION_PATTERNS = [
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b/u,
    /\b(?:next|nuxt|vite|astro|remix)\s+build\b/u,
    /\bnext start\b/u,
    /\bnuxt start\b/u,
    /\bvite preview\b/u,
    /\bastro preview\b/u,
    /\bremix-serve\b/u,
    /\bnode\s+(?:\.\/)?(?:dist|build|out|\.output)\//u,
    /\bserve\b/u,
    /NODE_ENV=production/u,
  ];

/**
 * A production server usually ships without source maps, which degrades
 * Affected Page detection (ADR 0002). Script aliases are resolved through the manifest.
 */
export const looksLikeProductionServer = (
  startCommand: string,
  manifest: PackageManifest
): boolean => {
  const visited = new Set<string>(),
    check = (command: string): boolean => {
      if (PRODUCTION_PATTERNS.some((pattern) => pattern.test(command))) {
        return true;
      }
      const alias = SCRIPT_ALIAS.exec(command.trim())?.[1];
      if (!alias || visited.has(alias)) {
        return false;
      }
      visited.add(alias);
      return [`pre${alias}`, alias, `post${alias}`].some((name) => {
        const script = manifest.scripts?.[name];
        return script !== undefined && check(script);
      });
    };
  return check(startCommand);
};
