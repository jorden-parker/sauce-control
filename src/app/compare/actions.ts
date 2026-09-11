"use server";

import { revalidatePath } from "next/cache";
import {
  startCurrentComparison,
  stopCurrentComparison,
} from "@/comparison/current-comparison";
import { gitHubClient } from "@/github/github";
import { settings } from "@/settings/settings";
import { isScenarioName } from "@/scenarios/scenario-name";

/** Branch names of one Repository in the saved Organisation, for the Target Branch ComboBox. */
export const listBranches = async (repository: string): Promise<string[]> => {
  const organisation = settings().getOrganisation(),
    client = await gitHubClient("compare-branches");
  if (organisation === undefined || client === undefined) {
    return [];
  }
  return client.listBranches(organisation, repository);
};

export const saveComparisonSelection = async (
  formData: FormData
): Promise<void> => {
  const field = (name: string) => String(formData.get(name) ?? "").trim(),
    selection = {
      baseBranch: field("baseBranch"),
      repository: field("repository"),
      targetBranch: field("targetBranch"),
    };
  if (Object.values(selection).some((value) => value === "")) {
    return;
  }
  settings().saveComparisonSelection(selection);
  revalidatePath("/compare");
};

export const startComparison = async (formData: FormData): Promise<void> => {
  const scenario = String(formData.get("scenario") ?? "recorded");
  if (!isScenarioName(scenario)) return;
  await startCurrentComparison(scenario);
  revalidatePath("/compare");
};

export const stopComparison = async (): Promise<void> => {
  await stopCurrentComparison();
  revalidatePath("/compare");
};
