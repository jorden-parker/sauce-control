import { expect, test } from "@playwright/test";

test("saves optional host setup, shows safe failure and cancellation, and retries with fresh setup", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("Organisation").fill("sauce-labs");
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(page.getByText("Current Organisation:")).toBeVisible();
  const configure = async (command: string) => {
    await page.goto("/repositories/web-app");
    await page
      .getByLabel("Environment Setup Command", { exact: true })
      .fill(command);
    await page.getByRole("button", { name: "Save configuration" }).click();
    await expect(page.getByTestId("saved-config")).toBeVisible();
    await page.reload();
    await expect(
      page.getByLabel("Environment Setup Command", { exact: true })
    ).toHaveValue(command);
  };
  await configure("echo synthetic-private-output >&2; exit 42");
  await page.goto("/compare");
  const stop = page.getByRole("button", { name: "Stop Comparison" });
  if (await stop.isVisible()) {
    await stop.click();
  }
  await page.getByRole("combobox", { name: "Repository" }).click();
  await page.getByRole("option", { name: "web-app" }).click();
  await page.getByRole("combobox", { name: "Target Branch" }).click();
  await page.getByRole("option", { name: "feature/login" }).click();
  await page.getByRole("button", { name: "Save Comparison" }).click();
  await expect(page.getByTestId("saved-selection")).toBeVisible();
  await page.getByRole("button", { name: "Run Comparison" }).click();
  await expect(page.getByTestId("comparison-error")).toContainText("exit 42");
  await expect(page.locator("body")).not.toContainText(
    "synthetic-private-output"
  );
  await configure("sleep 30");
  await page.goto("/compare");
  await page.getByRole("button", { name: /Retry|Run Comparison/ }).click();
  await expect(
    page.getByText("Complete browser login", { exact: false }).first()
  ).toBeVisible();
  await page.getByRole("button", { name: /Cancel/ }).click();
  await expect(
    page.getByText("Cleanup complete.", { exact: true }).first()
  ).toBeVisible();
  await configure("export NODE_AUTH_TOKEN=synthetic-setup-token");
  await page.goto("/compare");
  await page.getByRole("button", { name: /Retry|Run Comparison/ }).click();
  await expect(
    page
      .getByText("Environment setup completed (exit 0).", { exact: true })
      .first()
  ).toBeVisible();
  await expect(stop).toBeVisible();
  await expect(page.locator("body")).not.toContainText("synthetic-setup-token");
  await stop.click();
  await configure("");
});
