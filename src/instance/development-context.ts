import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import {
  type PackageManifest,
  inferRepositoryConfig,
  looksLikeProductionServer,
} from "@/repository-config/infer-config";
import { EnvironmentFileError } from "@/repository-config/environment-files";
import { DEVELOPMENT_LAUNCHER } from "./development-launcher";
import type { InstanceRequest } from "./run-instance";

/** Stage only source; original checkouts and selected files are never mounted or changed. */
export const prepareDevelopmentContext = (
  clonePath: string,
  request: InstanceRequest
) => {
  let manifest: PackageManifest;
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(clonePath, "package.json"), "utf8")
    );
    if (!parsed || typeof parsed !== "object") {
      throw new Error();
    }
    manifest = parsed as PackageManifest;
    if (
      manifest.scripts &&
      Object.values(manifest.scripts).some((value) => typeof value !== "string")
    ) {
      throw new Error();
    }
    if (
      manifest.packageManager !== undefined &&
      typeof manifest.packageManager !== "string"
    ) {
      throw new Error();
    }
  } catch {
    throw new EnvironmentFileError(
      "The branch needs a valid package.json to run a development server."
    );
  }
  const lockfiles: Record<string, string[]> = {
      bun: ["bun.lock", "bun.lockb"],
      npm: ["package-lock.json", "npm-shrinkwrap.json"],
      pnpm: ["pnpm-lock.yaml"],
      yarn: ["yarn.lock"],
    },
    found = Object.entries(lockfiles)
      .filter(([, files]) =>
        files.some((file) => existsSync(join(clonePath, file)))
      )
      .map(([name]) => name),
    declared = manifest.packageManager?.split("@")[0];
  if (
    found.length > 1 ||
    (declared &&
      (!(declared in lockfiles) ||
        (found.length === 1 && found[0] !== declared)))
  ) {
    throw new EnvironmentFileError(
      "Package-manager metadata conflicts with the lockfile. Update the Repository configuration."
    );
  }
  const inferred = inferRepositoryConfig({
      ...manifest,
      packageManager: manifest.packageManager ?? found[0] ?? "npm",
    }),
    development = {
      installCommand: request.config.installCommand || inferred.installCommand,
      startCommand: inferred.startCommand || request.config.startCommand,
    };
  // Validate saved commands too, even if inference would replace an old production command.
  if (
    [
      development.installCommand,
      development.startCommand,
      request.config.installCommand,
      request.config.startCommand,
      ...["preinstall", "install", "postinstall", "prepare"].map(
        (script) => manifest.scripts?.[script] ?? ""
      ),
    ].some((command) => looksLikeProductionServer(command, manifest))
  ) {
    throw new EnvironmentFileError(
      "Production commands cannot run. Save dependency-installation and development-server commands in Repository configuration."
    );
  }
  if (!development.startCommand.trim()) {
    throw new EnvironmentFileError(
      "No dev or develop script found. Configure a development-server command."
    );
  }
  const context = `${clonePath}-development`,
    excluded = new Set(
      (request.environmentFiles ?? []).flatMap((file) => {
        const roots = [
          clonePath,
          ...(request.codeDirectory
            ? [join(request.codeDirectory, request.repository)]
            : []),
        ];
        return roots
          .map((root) =>
            relative(
              existsSync(root) ? realpathSync(root) : root,
              existsSync(file) ? realpathSync(file) : file
            )
          )
          .filter(
            (path) =>
              path !== ".." && !path.startsWith("../") && !isAbsolute(path)
          );
      })
    );
  mkdirSync(context, { mode: 0o700, recursive: true });
  cpSync(clonePath, join(context, "source"), {
    filter: (path) => {
      const name = basename(path);
      return (
        ![
          ".git",
          "node_modules",
          ".next",
          "Dockerfile",
          ".dockerignore",
        ].includes(name) &&
        !/^\.env(?:\.|$)/u.test(name) &&
        !excluded.has(relative(clonePath, path)) &&
        !lstatSync(path).isSymbolicLink()
      );
    },
    recursive: true,
  });
  writeFileSync(join(context, "launcher.cjs"), DEVELOPMENT_LAUNCHER);
  return { context, development };
};
