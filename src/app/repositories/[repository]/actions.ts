"use server";

import { revalidatePath } from "next/cache";
import { keychain } from "@/keychain";
import {
  parseEnvironment,
  saveEnvironment,
} from "@/repository-config/environment";
import { settings } from "@/settings/settings";

const DEFAULT_PORT = 3000;

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
    buildCommand: field("buildCommand"),
    port: Number.isNaN(port) ? DEFAULT_PORT : port,
    startCommand: field("startCommand"),
    useDotEnvLocal: formData.get("useDotEnvLocal") === "on",
  });
  const pasted = String(formData.get("environment") ?? "");
  if (pasted.trim() !== "") {
    saveEnvironment(keychain, repository, parseEnvironment(pasted));
  }
  revalidatePath(`/repositories/${repository}`);
};
