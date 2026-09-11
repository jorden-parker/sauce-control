import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Organisation").fill("sauce-labs");
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(page.getByText("Current Organisation:")).toBeVisible();
});

test("reviewer sees the Endpoints a Comparison called, with a personal-data warning, and purges them", async ({
  page,
}) => {
  await page.goto("/compare");
  await page.getByRole("combobox", { name: "Repository" }).click();
  await page.getByRole("option", { name: "web-app" }).click();
  await page.getByRole("combobox", { name: "Target Branch" }).click();
  await page.getByRole("option", { name: "feature/login" }).click();
  await page.getByRole("button", { name: "Save Comparison" }).click();
  await page.getByRole("button", { name: "Run Comparison" }).click();
  await expect(page.getByTestId("comparison-status")).toContainText(
    "Both Instances of web-app are up.",
    { timeout: 30_000 }
  );
  // Discovery has crawled both Instances by now; the recordings outlive the Comparison.
  await page.getByRole("button", { name: "Stop Comparison" }).click();
  await expect(
    page.getByRole("button", { name: "Run Comparison" })
  ).toBeVisible();

  await page.goto("/repositories/web-app");
  const endpoints = page.getByTestId("endpoints");
  await expect(endpoints).toContainText("may contain personal data");
  // Every stubbed Comparison serves its fixture API on a fresh port, so earlier runs add rows.
  const row = endpoints
    .getByTestId("endpoint-row")
    .filter({ hasText: "/users/{n}" })
    .first();
  await expect(row).toContainText("GET");
  await expect(row).toContainText(/\d+ samples?/u);

  await endpoints.getByRole("button", { name: "Purge recordings" }).click();
  await expect(endpoints.getByTestId("endpoint-row")).toHaveCount(0);
  await expect(endpoints).toContainText("No Endpoints recorded");
});
