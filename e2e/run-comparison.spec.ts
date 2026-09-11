import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Organisation").fill("sauce-labs");
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(page.getByText("Current Organisation:")).toBeVisible();
});

test("reviewer runs the saved Comparison and gets a Proxy link to each Instance, then stops it", async ({
  page,
}) => {
  await page.goto("/compare");
  await page.getByRole("combobox", { name: "Repository" }).click();
  await page.getByRole("option", { name: "web-app" }).click();
  await page.getByRole("combobox", { name: "Target Branch" }).click();
  await page.getByRole("option", { name: "feature/login" }).click();
  await page.getByRole("button", { name: "Save Comparison" }).click();
  await expect(page.getByTestId("saved-selection")).toBeVisible();

  await page.getByRole("button", { name: "Run Comparison" }).click();

  const status = page.getByTestId("comparison-status");
  await expect(status).toContainText("Both Instances of web-app are up.");
  const links = status.getByRole("link", {
    name: /^http:\/\/127\.0\.0\.1:\d+\/$/u,
  });
  await expect(links).toHaveCount(2);
  await expect(links.first()).not.toHaveAttribute(
    "href",
    (await links.last().getAttribute("href")) ?? ""
  );

  const pages = page.getByTestId("discovered-pages");
  await expect(pages.getByRole("listitem")).toContainText([
    "/",
    "/about",
    "/panel",
  ]);

  await page.getByRole("button", { name: "Stop Comparison" }).click();
  await expect(
    page.getByRole("button", { name: "Run Comparison" })
  ).toBeVisible();
});
