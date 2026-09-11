import { type FrameLocator, type Page, expect, test } from "@playwright/test";

/** Runs the stubbed Comparison (a fixture app behind the real Proxy) and returns both frames. */
const runComparison = async (page: Page) => {
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
  await page.getByRole("button", { name: "Run Comparison" }).click();
  const base = page.frameLocator('iframe[title="Base Instance"]'),
    target = page.frameLocator('iframe[title="Target Instance"]');
  await expect(
    base.getByRole("heading", { name: "Home (base)" })
  ).toBeVisible();
  await expect(
    target.getByRole("heading", { name: "Home (target)" })
  ).toBeVisible();
  return { base, target };
};

test.afterEach(async ({ page }) => {
  await page.getByRole("button", { name: "Stop Comparison" }).click();
});

test("both Instances sit in device frames and a click in one is replayed in the other by role and name", async ({
  page,
}) => {
  const { base, target } = await runComparison(page);
  await expect(page.getByTestId("device-frame")).toHaveCount(2);

  // The Target Branch moved the About link into a different container.
  await base.getByRole("link", { name: "About" }).click();
  await expect(
    target.getByRole("heading", { name: "About (target)" })
  ).toBeVisible();
  await expect(
    base.getByRole("heading", { name: "About (base)" })
  ).toBeVisible();

  // And the other way round.
  await target.getByRole("link", { name: "Home" }).click();
  await expect(
    base.getByRole("heading", { name: "Home (base)" })
  ).toBeVisible();
});

const expectEcho = (frame: FrameLocator, id: string, text: string) =>
  expect(frame.locator(`#${id}`)).toHaveText(text);

test("typing, focus, hover, scroll, and history navigation are replayed", async ({
  page,
}) => {
  const { base, target } = await runComparison(page);

  await base.getByLabel("Name").fill("Ada");
  await expectEcho(target, "name-echo", "Ada");
  await expect(target.getByLabel("Name")).toHaveValue("Ada");

  await base.getByLabel("Name").blur();
  await base.getByLabel("Name").focus();
  await expectEcho(target, "focus-echo", "name");

  await base.getByText("Hover me").hover();
  await expectEcho(target, "hover-echo", "hovered");

  await base.locator("#pane").evaluate((pane) => {
    pane.scrollTop = 150;
  });
  await expectEcho(target, "scroll-echo", "150");

  await base.getByRole("button", { name: "Open panel" }).click();
  await expectEcho(target, "path-echo", "/panel");
});

test("a desync badge appears when the sibling has no matching element", async ({
  page,
}) => {
  const { base } = await runComparison(page);
  await expect(page.getByTestId("desync-target")).toBeHidden();

  await base.getByRole("button", { name: "Delete" }).click();

  const badge = page.getByTestId("desync-target");
  await expect(badge).toBeVisible();
  await expect(badge).toContainText("Desync");
  await expect(badge).toContainText("Delete");
  await expect(page.getByTestId("desync-base")).toBeHidden();
});
