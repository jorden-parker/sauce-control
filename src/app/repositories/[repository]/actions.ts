"use server";

import { revalidatePath } from "next/cache";
import { endpointRecordings } from "@/endpoints/endpoint-recordings";
import { keychain } from "@/keychain";
import {
  parseEnvironment,
  saveEnvironment,
} from "@/repository-config/environment";
import { settings } from "@/settings/settings";
import { DEFAULT_CRAWL_LIMITS } from "@/crawler/crawl-limits";

const DEFAULT_PORT = 3000,
  integer = (text: string, fallback: number): number => {
    const value = Number.parseInt(text, 10);
    return Number.isNaN(value) || value < 0 ? fallback : value;
  },
  /** One path per line; anything not starting with a slash gets one. */
  pathList = (text: string): string[] =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .map((line) => (line.startsWith("/") ? line : `/${line}`));

/** Saves the commands and port in settings and any pasted variables in the keychain only. */
export const saveRepositoryConfig = async (
  formData: FormData
): Promise<void> => {
  const field = (name: string) => String(formData.get(name) ?? "").trim(),
    repository = field("repository"),
    port = Number.parseInt(field("port"), 10);
  if (repository === "") {
    return;
  }
  settings().saveRepositoryConfig(repository, {
    crawl: {
      collapseNumericSegments: formData.get("collapseNumericSegments") === "on",
      maxDepth: integer(field("maxDepth"), DEFAULT_CRAWL_LIMITS.maxDepth),
      pageLimit: integer(field("pageLimit"), DEFAULT_CRAWL_LIMITS.pageLimit),
      stripQuery: formData.get("stripQuery") === "on",
    },
    installCommand: field("installCommand"),
    pages: {
      added: pathList(field("addedPages")),
      removed: pathList(field("removedPages")),
    },
    port: Number.isNaN(port) ? DEFAULT_PORT : port,
    startCommand: field("startCommand"),
  });
  const pasted = String(formData.get("environment") ?? "");
  if (pasted.trim() !== "") {
    saveEnvironment(keychain, repository, parseEnvironment(pasted));
  }
  revalidatePath(`/repositories/${repository}`);
};

/** Deletes every Endpoint call recorded for the Repository. */
export const purgeEndpointRecordings = async (
  formData: FormData
): Promise<void> => {
  const repository = String(formData.get("repository") ?? "").trim();
  if (repository === "") {
    return;
  }
  endpointRecordings().purge(repository);
  revalidatePath(`/repositories/${repository}`);
};
