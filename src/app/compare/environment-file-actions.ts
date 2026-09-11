"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { settings } from "@/settings/settings";
import {
  type DirectoryListing,
  EnvironmentFileError,
  browseEnvironmentDirectory,
  normalizeEnvironmentPaths,
  readEnvironmentFiles,
} from "@/repository-config/environment-files";

/** Local filesystem access must not be callable through a foreign origin or DNS rebinding. */
const assertLocalRequest = async () => {
  const request = await headers(),
    origin = request.get("origin"),
    host = request.get("host");
  if (!origin || !host) {
    throw new EnvironmentFileError(
      "File access requires a local browser session."
    );
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new EnvironmentFileError(
      "File access requires a local browser session."
    );
  }
  if (
    url.host !== host ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !["http:", "https:"].includes(url.protocol)
  ) {
    throw new EnvironmentFileError(
      "File access requires a local browser session."
    );
  }
};

export const browseFiles = async (
  directory: string
): Promise<{ listing?: DirectoryListing; error?: string }> => {
  try {
    await assertLocalRequest();
    return { listing: await browseEnvironmentDirectory(directory) };
  } catch (error) {
    return {
      error:
        error instanceof EnvironmentFileError
          ? error.message
          : "Could not open this folder.",
    };
  }
};

export const saveEnvironmentFiles = async (
  repository: string,
  input: string[]
): Promise<{ error?: string }> => {
  try {
    await assertLocalRequest();
    if (!repository || repository.length > 200) {
      throw new EnvironmentFileError("Select a Repository first.");
    }
    const paths = normalizeEnvironmentPaths(input);
    await readEnvironmentFiles(paths);
    settings().saveEnvironmentFiles(repository, paths);
    revalidatePath("/compare");
    return {};
  } catch (error) {
    return {
      error:
        error instanceof EnvironmentFileError
          ? error.message
          : "Could not save the Environment File paths.",
    };
  }
};
