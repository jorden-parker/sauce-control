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

export const startContainerRuntime = async (
  formData: FormData
): Promise<void> => {
  const runtime = String(formData.get("runtime") ?? "");
  if (!isRuntimeName(runtime)) {
    return;
  }
  await startRuntime(runtimeAdapter, runtime, START_OPTIONS);
  settings().saveContainerRuntime(runtime);
  revalidatePath("/settings");
};
