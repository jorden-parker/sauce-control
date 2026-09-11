"use server";

import { revalidatePath } from "next/cache";
import { settings } from "@/settings/settings";

export const saveOrganisation = async (formData: FormData): Promise<void> => {
  const organisation = String(formData.get("organisation") ?? "").trim();
  if (organisation === "") {
    return;
  }
  settings().saveOrganisation(organisation);
  revalidatePath("/settings");
};
