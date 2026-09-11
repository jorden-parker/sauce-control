import { type Page, expect, test } from "@playwright/test";

const progress = (page: Page) =>
  page.evaluate(async () => {
    const response = await fetch("/compare/progress"),
      reader = response.body!.getReader(),
      data = new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    return JSON.parse(data.slice("data: ".length));
  });

test.beforeEach(async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Organisation").fill("sauce-labs");
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(page.getByText("Current Organisation:")).toBeVisible();
  await page.goto("/compare");
  await page.getByRole("combobox", { name: "Repository" }).click();
  await page.getByRole("option", { name: "web-app" }).click();
  await page.getByRole("combobox", { name: "Target Branch" }).click();
  await page.getByRole("option", { name: "feature/login" }).click();
  await page.getByRole("button", { name: "Save Comparison" }).click();
  await expect(page.getByTestId("saved-selection")).toBeVisible();
});

test("streams progress and restores the same attempt after navigation and refresh", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Run Comparison" }).click();
  await expect(page.getByTestId("startup-progress")).toBeVisible();
  const before = await progress(page);
  await page.goto("/settings");
  await page.goto("/compare");
  await page.reload();
  await expect(page.getByTestId("comparison-status")).toContainText(
    "Both Instances of web-app are up.",
    { timeout: 30_000 }
  );
  const after = await progress(page);
  expect(after.progress.id).toBe(before.progress.id);
  expect(after.progress.outcome).toBe("ready");
  await page.getByText("Progress messages", { exact: true }).click();
  await expect(
    page.getByRole("list", { name: "Progress messages" })
  ).toContainText("Comparison ready.");
  await expect(page.getByTestId("startup-progress")).toContainText(
    "Startup elapsed:"
  );
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Stop Comparison" }).click();
  await expect(
    page.getByRole("button", { name: "Run Comparison" })
  ).toBeEnabled();
  expect((await progress(page)).progress.id).toBe(before.progress.id);
});

test("Cancel stops startup, retains its messages, and permits a fresh attempt after cleanup", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Run Comparison" }).click();
  await page.getByRole("button", { exact: true, name: "Cancel" }).click();
  await expect(page.getByTestId("comparison-status")).toContainText(
    "Comparison startup cancelled."
  );
  await expect(page.getByTestId("startup-progress")).toContainText(
    "Cleanup complete."
  );
  const cancelled = await progress(page);
  expect(cancelled.progress.outcome).toBe("cancelled");
  await page.reload();
  await expect(page.getByTestId("comparison-status")).toContainText(
    "Comparison startup cancelled."
  );
  await page.getByRole("button", { name: "Run Comparison" }).click();
  const next = await progress(page);
  expect(next.progress.id).not.toBe(cancelled.progress.id);
  await page.getByRole("button", { exact: true, name: "Cancel" }).click();
  await expect(page.getByTestId("startup-progress")).toContainText(
    "Cleanup complete."
  );
});
