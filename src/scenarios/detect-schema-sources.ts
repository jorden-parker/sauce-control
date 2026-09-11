/* Sequential traversal shares a bounded file budget and avoids opening thousands of files at once. */
/* oxlint-disable no-await-in-loop */
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readSchemaSource } from "./read-schema-source";
import type { SchemaSource } from "./schema-sources";

/** Read local contract files only; never traverse symlinks or fetch from GitHub. */
export const detectSchemaSources = async (
  roots: string[]
): Promise<SchemaSource[]> => {
  const sources: SchemaSource[] = [],
    visited = new Set<string>();
  let remaining = 20_000;
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 8 || remaining <= 0 || visited.has(directory)) {
      return;
    }
    visited.add(directory);
    try {
      if (!(await lstat(directory)).isDirectory()) {
        return;
      }
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (--remaining < 0) {
          return;
        }
        const path = join(directory, entry.name);
        if (
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          !["node_modules", "dist", "build", "vendor"].includes(entry.name)
        ) {
          await walk(path, depth + 1);
        } else if (
          entry.isFile() &&
          /^(openapi|swagger)\.(json|ya?ml)$/iu.test(entry.name)
        ) {
          try {
            sources.push(readSchemaSource(path, await readFile(path, "utf8")));
          } catch {
            /* A malformed candidate is not a Schema Source. */
          }
        }
      }
    } catch {
      /* Missing or unreadable directories do not prevent scanning other roots. */
    }
  };
  for (const root of roots.filter(Boolean)) {
    await walk(resolve(root), 0);
  }
  return sources;
};
