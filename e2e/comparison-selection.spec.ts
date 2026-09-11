import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Organisation").fill("sauce-labs");
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(page.getByText("Current Organisation:")).toBeVisible();
});

test("reviewer picks a Repository and Target Branch with the Base Branch pre-filled", async ({
  page,
}) => {
  await page.goto("/compare");

  await page.getByRole("combobox", { name: "Repository" }).click();
  await page.getByPlaceholder("Search repositories…").fill("web");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.getByRole("option", { name: "web-app" }).click();

  await expect(page.getByLabel("Base Branch")).toHaveValue("main");

  await page.getByRole("combobox", { name: "Target Branch" }).click();
  await page.getByPlaceholder("Search branches…").fill("check");
  await page.getByRole("option", { name: "feature/checkout" }).click();

  await page.getByRole("button", { name: "Save Comparison" }).click();
  await expect(page.getByTestId("saved-selection")).toContainText(
    "web-app feature/checkout against main"
  );
});

test("reviewer overrides the Base Branch", async ({ page }) => {
  await page.goto("/compare");
  await page.getByRole("combobox", { name: "Repository" }).click();
  await page.getByRole("option", { name: "web-app" }).click();
  await page.getByRole("combobox", { name: "Target Branch" }).click();
  await page.getByRole("option", { name: "feature/login" }).click();

  await page.getByLabel("Base Branch").fill("release/2026-09");
  await page.getByRole("button", { name: "Save Comparison" }).click();

  await expect(page.getByTestId("saved-selection")).toContainText(
    "web-app feature/login against release/2026-09"
  );
});
