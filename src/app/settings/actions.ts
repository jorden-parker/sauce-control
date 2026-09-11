"use server";

import { revalidatePath } from "next/cache";
import { runtimeAdapter } from "@/container-runtime/runtime";
import { isRuntimeName } from "@/container-runtime/runtime-status";
import { startRuntime } from "@/container-runtime/start-runtime";
import { updateInstancePort } from "@/comparison/current-comparison";
import { GITHUB_TOKEN_SECRET } from "@/github/github-token";
import {
  startInstance as startInstanceContainer,
  stopInstance as stopInstanceContainer,
} from "@/instance/instances";
import { removeAllInstances } from "@/instance/session";
import { keychain } from "@/keychain";
import { settings } from "@/settings/settings";

export const saveOrganisation = async (formData: FormData): Promise<void> => {
  const organisation = String(formData.get("organisation") ?? "").trim();
  if (organisation === "") {
    return;
  }
  settings().saveOrganisation(organisation);
  revalidatePath("/settings");
};

/** Stores a pasted personal access token in the OS keychain only. */
export const saveGitHubToken = async (formData: FormData): Promise<void> => {
  const token = String(formData.get("githubToken") ?? "").trim();
  if (token === "") {
    return;
  }
  keychain.setSecret(GITHUB_TOKEN_SECRET, token);
  revalidatePath("/settings");
};

export const saveContainerRuntime = async (
  formData: FormData
): Promise<void> => {
  const runtime = String(formData.get("runtime") ?? "");
  if (!isRuntimeName(runtime)) {
    return;
  }
  settings().saveContainerRuntime(runtime);
  revalidatePath("/settings");
};

const START_OPTIONS = { pollIntervalMs: 1000, timeoutMs: 120_000 };

/** Outcome of a start attempt, rendered by the Settings page. */
export interface StartResult {
  error?: string;
}

export const startContainerRuntime = async (
  _previous: StartResult,
  formData: FormData
): Promise<StartResult> => {
  const runtime = String(formData.get("runtime") ?? "");
  if (!isRuntimeName(runtime)) {
    return { error: `Unknown runtime: ${runtime}` };
  }
  try {
    await startRuntime(runtimeAdapter, runtime, START_OPTIONS);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  settings().saveContainerRuntime(runtime);
  revalidatePath("/settings");
  return {};
};

/** The chosen runtime, or nothing when none is saved; the Instances card is hidden in that case. */
const chosenRuntime = () => settings().getContainerRuntime(),
  containerIdFrom = (formData: FormData): string =>
    String(formData.get("containerId") ?? "").trim();

export const stopInstance = async (formData: FormData): Promise<void> => {
  const runtime = chosenRuntime(),
    containerId = containerIdFrom(formData);
  if (runtime === undefined || containerId === "") {
    return;
  }
  await stopInstanceContainer(runtimeAdapter, runtime, containerId);
  revalidatePath("/settings");
};

export const startInstance = async (formData: FormData): Promise<void> => {
  const runtime = chosenRuntime(),
    containerId = containerIdFrom(formData);
  if (runtime === undefined || containerId === "") {
    return;
  }
  const hostPort = await startInstanceContainer(
    runtimeAdapter,
    runtime,
    containerId
  );
  if (hostPort !== undefined) {
    updateInstancePort(containerId, hostPort);
  }
  revalidatePath("/settings");
};

/** Removes every Instance this Sauce Control owns, whichever session started it. */
export const stopAllInstances = async (): Promise<void> => {
  const runtime = chosenRuntime();
  if (runtime === undefined) {
    return;
  }
  await removeAllInstances(runtimeAdapter, runtime);
  revalidatePath("/settings");
};
