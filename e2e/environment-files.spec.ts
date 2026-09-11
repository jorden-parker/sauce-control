import { mkdtemp, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("selects and orders local files, persists only paths, and safely rejects a disappeared file", async ({
  page,
}) => {
  const directory = await realpath(
      await mkdtemp(join(tmpdir(), "environment-picker-"))
    ),
    first = join(directory, ".env.first"),
    second = join(directory, ".env.second"),
    secret = "synthetic-ui-secret-98423";
  await writeFile(first, `TOKEN="${secret}"\n`);
  await writeFile(second, "TOKEN=override\n");
  try {
    await page.goto("/settings");
    await page.getByLabel("Organisation").fill("sauce-labs");
    await page.getByRole("button", { exact: true, name: "Save" }).click();
    await expect(page.getByText("Current Organisation:")).toBeVisible();
    await page.goto("/compare");
    const stop = page.getByRole("button", { name: "Stop Comparison" });
    if (await stop.isVisible()) {
      await stop.click();
      await expect(
        page.getByRole("button", { name: "Run Comparison" })
      ).toBeVisible();
    }
    await page.getByRole("combobox", { name: "Repository" }).click();
    await page.getByRole("option", { name: "web-app" }).click();
    await page.getByRole("combobox", { name: "Target Branch" }).click();
    await page.getByRole("option", { name: "feature/login" }).click();
    await page.getByRole("button", { name: "Save Comparison" }).click();
    await expect(page.getByTestId("saved-selection")).toBeVisible();
    await page.getByRole("button", { name: "Browse files" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Select Environment Files",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { exact: true, name: "Open folder" })
    ).toBeEnabled();
    await dialog.getByLabel("Folder path").fill(directory);
    await dialog
      .getByRole("button", { exact: true, name: "Open folder" })
      .click();
    await dialog.getByLabel(".env.first", { exact: true }).check();
    await dialog.getByLabel(".env.second", { exact: true }).check();
    await expect(page.locator("body")).not.toContainText(secret);
    await dialog
      .getByRole("button", { exact: true, name: "Add files" })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Run Comparison" })
    ).toBeDisabled();
    await page.getByRole("button", { name: "Move file 2 up" }).click();
    await expect(
      page.getByLabel("Environment File 1", { exact: true })
    ).toHaveValue(second);
    await page.getByRole("button", { name: "Save file paths" }).click();
    await expect(page.getByText("File paths saved.")).toBeVisible();
    await page.reload();
    await expect(
      page.getByLabel("Environment File 2", { exact: true })
    ).toHaveValue(first);
    await expect(page.locator("body")).not.toContainText(secret);
    await unlink(first);
    await page.getByRole("button", { name: "Run Comparison" }).click();
    await expect(page.getByTestId("comparison-error")).toContainText(
      "missing or unreadable"
    );
    await expect(page.locator("body")).not.toContainText(secret);
    await page.getByRole("button", { name: "Remove file 2" }).click();
    await page.getByRole("button", { name: "Remove file 1" }).click();
    await page.getByRole("button", { name: "Save file paths" }).click();
    await expect(page.getByText("File paths saved.")).toBeVisible();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
