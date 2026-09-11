import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Organisation").fill("sauce-labs");
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(page.getByText("Current Organisation:")).toBeVisible();
});

test("reviewer sees commands pre-filled from the package manifest, gets a production warning, and saves", async ({
  page,
}) => {
  await page.goto("/repositories/web-app");

  await expect(page.getByLabel("Build command")).toHaveValue(
    "pnpm install --frozen-lockfile"
  );
  await expect(page.getByLabel("Start command")).toHaveValue("pnpm run dev");
  await expect(page.getByLabel("Port")).toHaveValue("3000");
  await expect(page.getByTestId("production-warning")).toBeHidden();

  await page.getByLabel("Start command").fill("pnpm run start");
  await expect(page.getByTestId("production-warning")).toContainText(
    "looks like a production server"
  );

  await page.getByLabel("Port").fill("4000");
  await page
    .getByLabel("Environment variables")
    .fill("API_URL=https://api.example.test\nSECRET=shh");
  await page.getByLabel("Use the clone's .env.local").check();
  await page.getByRole("button", { name: "Save configuration" }).click();

  await expect(page.getByTestId("saved-config")).toContainText("Saved");
  await expect(page.getByTestId("environment-count")).toContainText(
    "2 variables stored in the keychain"
  );

  await page.reload();
  await expect(page.getByLabel("Start command")).toHaveValue("pnpm run start");
  await expect(page.getByLabel("Port")).toHaveValue("4000");
  await expect(page.getByLabel("Use the clone's .env.local")).toBeChecked();
  await expect(page.getByLabel("Environment variables")).toHaveValue("");
});

test("reviewer reaches the Repository Config from the Comparison form", async ({
  page,
}) => {
  await page.goto("/compare");
  await page.getByRole("combobox", { name: "Repository" }).click();
  await page.getByRole("option", { name: "web-app" }).click();
  await page.getByRole("link", { name: "Configure web-app" }).click();
  await expect(page).toHaveURL(/\/repositories\/web-app$/u);
});
