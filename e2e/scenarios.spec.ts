import { expect, test } from "@playwright/test";

test("reviewer chooses an empty Scenario before running and both Instances receive empty data", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("Organisation").fill("sauce-labs");
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await page.goto("/compare");
  await page.getByRole("combobox", { name: "Repository", exact: true }).click();
  await page.getByRole("option", { name: "web-app" }).click();
  await page.getByRole("combobox", { name: "Target Branch" }).click();
  await page.getByRole("option", { name: "feature/login" }).click();
  await page.getByRole("button", { name: "Save Comparison" }).click();
  await page.getByLabel("Scenario", { exact: true }).selectOption("empty");
  await page.getByRole("button", { name: "Run Comparison" }).click();
  try {
    await expect(page.getByTestId("comparison-status")).toContainText(
      "Active Scenario: empty",
      { timeout: 30_000 }
    );
    await Promise.all(
      ["Base Instance", "Target Instance"].map(async (title) => {
        await expect(
          page
            .frameLocator(`iframe[title="${title}"]`)
            .getByTestId("endpoint-response")
        ).toHaveText('{"id":0,"name":""}');
      })
    );
  } finally {
    await page.getByRole("button", { name: "Stop Comparison" }).click();
  }
});
