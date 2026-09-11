import { constants } from "node:fs";
import { open, opendir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize } from "node:path";

export const MAX_ENVIRONMENT_BYTES = 1024 * 1024;
export const MAX_ENVIRONMENT_FILES = 32;

/** Only these deliberately constructed errors are safe to show to the reviewer. */
export class EnvironmentFileError extends Error {}

export const normalizeEnvironmentPaths = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > MAX_ENVIRONMENT_FILES) {
    throw new EnvironmentFileError("Select at most 32 Environment Files.");
  }
  return value.map((path: unknown) => {
    if (
      typeof path !== "string" ||
      path.length > 4096 ||
      /[\0\r\n]/u.test(path)
    ) {
      throw new EnvironmentFileError("Enter a valid absolute file path.");
    }
    const expanded = path.startsWith("~/")
      ? join(homedir(), path.slice(2))
      : path;
    if (!isAbsolute(expanded)) {
      throw new EnvironmentFileError("Enter an absolute file path.");
    }
    return normalize(expanded);
  });
};

/** Strict, literal dotenv parsing. No shell evaluation or escape decoding. */
export const parseEnvironmentFile = (
  text: string,
  file = "Environment File"
): Record<string, string> => {
  const result: Record<string, string> = Object.create(null),
    lines = text.replace(/^\uFEFF/u, "").split(/\r?\n/u),
    invalid = (line: number): never => {
      throw new EnvironmentFileError(
        `${file}, line ${line}: invalid assignment or quoted value.`
      );
    };
  if (text.includes("\0") || Buffer.byteLength(text) > MAX_ENVIRONMENT_BYTES) {
    throw new EnvironmentFileError(`${file}: invalid or oversized content.`);
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trimStart(),
      start = index + 1;
    if (line.trim() === "" || line.startsWith("#")) {
      continue;
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(
      line
    );
    if (!match) {
      invalid(start);
    }
    const key = match![1]!,
      raw = match![2]!,
      quote = raw[0];
    if (quote === '"' || quote === "'") {
      let value = raw.slice(1),
        closing = value.indexOf(quote);
      while (closing < 0 && index + 1 < lines.length) {
        value += `\n${lines[++index]}`;
        closing = value.indexOf(quote);
      }
      if (closing < 0 || !/^\s*(?:#.*)?$/u.test(value.slice(closing + 1))) {
        invalid(start);
      }
      result[key] = value.slice(0, closing);
    } else {
      result[key] = raw.replace(/(?:^|\s)#.*$/u, "").trimEnd();
    }
  }
  return result;
};

/* oxlint-disable no-await-in-loop -- Ordered, bounded reads avoid loading all files concurrently and preserve precedence. */
/** Bounded reads of regular files, never devices or FIFOs; errors contain no contents. */
export const readEnvironmentFiles = async (
  paths: string[],
  saved: Record<string, string> = {}
) => {
  const environment: Record<string, string> = Object.assign(
      Object.create(null),
      saved
    ),
    resolvedPaths: string[] = [];
  let total = 0;
  for (const path of normalizeEnvironmentPaths(paths)) {
    try {
      const resolved = await realpath(path),
        handle = await open(
          resolved,
          constants.O_RDONLY | constants.O_NONBLOCK
        );
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > MAX_ENVIRONMENT_BYTES) {
          throw new EnvironmentFileError(
            `${path}: select a regular file no larger than 1 MiB.`
          );
        }
        const buffer = Buffer.alloc(MAX_ENVIRONMENT_BYTES + 1);
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await handle.read(
            buffer,
            length,
            buffer.length - length,
            null
          );
          if (!bytesRead) {
            break;
          }
          length += bytesRead;
        }
        total += length;
        if (
          length > MAX_ENVIRONMENT_BYTES ||
          total > 4 * MAX_ENVIRONMENT_BYTES
        ) {
          throw new EnvironmentFileError(
            `${path}: Environment Files exceed the size limit.`
          );
        }
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(
            buffer.subarray(0, length)
          );
        } catch {
          throw new EnvironmentFileError(`${path}: expected valid UTF-8 text.`);
        }
        Object.assign(environment, parseEnvironmentFile(text, path));
        resolvedPaths.push(resolved);
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof EnvironmentFileError) {
        throw error;
      }
      throw new EnvironmentFileError(`${path}: file is missing or unreadable.`);
    }
  }
  return { environment, resolvedPaths };
};
/* oxlint-enable no-await-in-loop */

export const validateInstanceEnvironment = (
  environment: Record<string, string>,
  port: number
): void => {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new EnvironmentFileError(
      "Choose an Instance port between 1 and 65535."
    );
  }
  for (const [key, value] of Object.entries(environment)) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) ||
      typeof value !== "string" ||
      value.includes("\0")
    ) {
      throw new EnvironmentFileError(
        "A saved environment variable is invalid. Update the Repository configuration."
      );
    }
  }
  if (
    (environment.NODE_ENV !== undefined &&
      environment.NODE_ENV !== "development") ||
    (environment.PORT !== undefined && environment.PORT !== String(port))
  ) {
    throw new EnvironmentFileError(
      "NODE_ENV or PORT conflicts with the development-server configuration."
    );
  }
  if (
    Buffer.byteLength(JSON.stringify(environment)) >
    4 * MAX_ENVIRONMENT_BYTES
  ) {
    throw new EnvironmentFileError(
      "The combined environment exceeds the size limit."
    );
  }
};

export interface DirectoryListing {
  directory: string;
  parent: string;
  entries: { name: string; path: string; directory: boolean }[];
}

/** Metadata only, including dotfiles; never returns file content. */
export const browseEnvironmentDirectory = async (
  requested: string
): Promise<DirectoryListing> => {
  const [path] = normalizeEnvironmentPaths([requested || homedir()]);
  try {
    const directory = await realpath(path!),
      entries: DirectoryListing["entries"] = [];
    for await (const entry of await opendir(directory)) {
      if (entries.length >= 2000) {
        throw new EnvironmentFileError(
          "This folder is too large. Enter a more specific path."
        );
      }
      const entryPath = join(directory, entry.name);
      let isDirectory = entry.isDirectory(),
        isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        const info = await stat(entryPath).catch(() => {});
        isDirectory = info?.isDirectory() ?? false;
        isFile = info?.isFile() ?? false;
      }
      if (isDirectory || isFile) {
        entries.push({
          name: entry.name,
          path: entryPath,
          directory: isDirectory,
        });
      }
    }
    entries.sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name)
    );
    return { directory, entries, parent: dirname(directory) };
  } catch (error) {
    if (error instanceof EnvironmentFileError) {
      throw error;
    }
    throw new EnvironmentFileError("This folder is missing or unreadable.");
  }
};
