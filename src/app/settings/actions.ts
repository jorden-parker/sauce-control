"use server";

import { revalidatePath } from "next/cache";
import { runtimeAdapter } from "@/container-runtime/runtime";
import { isRuntimeName } from "@/container-runtime/runtime-status";
import { startRuntime } from "@/container-runtime/start-runtime";
import { settings } from "@/settings/settings";

export const saveOrganisation = async (formData: FormData): Promise<void> => {
  const organisation = String(formData.get("organisation") ?? "").trim();
  if (organisation === "") {
    return;
  }
  settings().saveOrganisation(organisation);
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
