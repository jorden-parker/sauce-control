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

  await expect(page.getByLabel("Dependency installation command")).toHaveValue(
    "pnpm install --frozen-lockfile"
  );
  await expect(page.getByLabel("Development server command")).toHaveValue(
    "pnpm run dev"
  );
  await expect(page.getByLabel("Port")).toHaveValue("3000");
  await expect(page.getByTestId("production-warning")).toBeHidden();

  await page.getByLabel("Development server command").fill("pnpm run start");
  await expect(page.getByTestId("production-warning")).toContainText(
    "Production commands cannot run"
  );

  await page.getByLabel("Port").fill("4000");
  await page
    .getByLabel("Environment variables")
    .fill("API_URL=https://api.example.test\nSECRET=shh");
  await expect(
    page.getByRole("button", { name: "Save configuration" })
  ).toBeDisabled();
  await page.getByLabel("Development server command").fill("pnpm run dev");
  await page.getByRole("button", { name: "Save configuration" }).click();

  await expect(page.getByTestId("saved-config")).toContainText("Saved");
  await expect(page.getByTestId("environment-count")).toContainText(
    "2 variables stored in the keychain"
  );

  await page.reload();
  await expect(page.getByLabel("Development server command")).toHaveValue(
    "pnpm run dev"
  );
  await expect(page.getByLabel("Port")).toHaveValue("4000");
  await expect(page.getByLabel("Use the clone's .env.local")).toHaveCount(0);
  await expect(page.getByLabel("Environment variables")).toHaveValue("");
});

test("reviewer bounds the crawl and adds or removes Pages by hand, and it persists", async ({
  page,
}) => {
  await page.goto("/repositories/web-app");

  await expect(page.getByLabel("Crawl depth")).toHaveValue("3");
  await expect(page.getByLabel("Page limit")).toHaveValue("50");
  await expect(page.getByLabel("Strip query strings")).toBeChecked();
  await expect(page.getByLabel("Collapse numeric segments")).toBeChecked();

  await page.getByLabel("Crawl depth").fill("2");
  await page.getByLabel("Page limit").fill("20");
  await page.getByLabel("Strip query strings").uncheck();
  await page.getByLabel("Added Pages").fill("/hidden\n/admin");
  await page.getByLabel("Removed Pages").fill("/legal");
  await page.getByRole("button", { name: "Save configuration" }).click();
  await expect(page.getByTestId("saved-config")).toContainText("Saved");

  await page.reload();
  await expect(page.getByLabel("Crawl depth")).toHaveValue("2");
  await expect(page.getByLabel("Page limit")).toHaveValue("20");
  await expect(page.getByLabel("Strip query strings")).not.toBeChecked();
  await expect(page.getByLabel("Collapse numeric segments")).toBeChecked();
  await expect(page.getByLabel("Added Pages")).toHaveValue("/hidden\n/admin");
  await expect(page.getByLabel("Removed Pages")).toHaveValue("/legal");
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
