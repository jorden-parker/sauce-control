import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

test("saves optional host setup, shows safe failure and cancellation, and retries with fresh setup", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("Organisation").fill("sauce-labs");
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(page.getByText("Current Organisation:")).toBeVisible();
  const configure = async (command: string) => {
    await page.goto("/settings#environment-setup");
    await page
      .getByLabel("Environment Setup Command", { exact: true })
      .fill(command);
    await page.getByRole("button", { name: "Save setup command" }).click();
    await expect(
      page.getByText("Setup command saved for all repositories.")
    ).toBeVisible();
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
  await page.goto("/repositories/web-app");
  await expect(
    page.getByLabel("Environment Setup Command", { exact: true })
  ).toHaveCount(0);
  await page.goto("/compare");
  await page.getByRole("link", { name: "Configure environment setup" }).click();
  await expect(page).toHaveURL(/\/settings#environment-setup$/u);
});

test("resolves conflicting legacy commands centrally and keeps an empty shared choice", async ({
  page,
}, testInfo) => {
  const database = new DatabaseSync(
      join(String(testInfo.config.metadata.dataDirectory), "settings.db")
    ),
    upsert = database.prepare(
      "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    );
  database
    .prepare("DELETE FROM settings WHERE key = ?")
    .run("environment-setup-command");
  for (const repository of ["migration-one", "migration-two"]) {
    upsert.run(
      `repository-config:${repository}`,
      JSON.stringify({
        environmentSetupCommand: `export TOKEN=${repository}`,
        installCommand: "",
        port: 3000,
        startCommand: "",
      })
    );
  }
  upsert.run("organisation", "sauce-labs");
  upsert.run(
    "comparison-selection",
    JSON.stringify({
      baseBranch: "main",
      repository: "web-app",
      targetBranch: "feature/login",
    })
  );
  try {
    await page.goto("/compare");
    await expect(
      page.getByRole("button", { name: "Run Comparison" })
    ).toBeDisabled();
    await expect(
      page.getByText("Resolve the different saved setup commands", {
        exact: false,
      })
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Configure environment setup" })
      .click();
    await page
      .getByRole("button", { name: "Use command from migration-two" })
      .click();
    await expect(
      page.getByLabel("Environment Setup Command", { exact: true })
    ).toHaveValue("export TOKEN=migration-two");
    await page.getByRole("button", { name: "Save setup command" }).click();
    await expect(
      page.getByText("Setup command saved for all repositories.")
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Choose an existing command" })
    ).toHaveCount(0);
    await page
      .getByLabel("Organisation", { exact: true })
      .fill("another-company");
    await page.getByRole("button", { exact: true, name: "Save" }).click();
    await page.reload();
    await expect(
      page.getByLabel("Environment Setup Command", { exact: true })
    ).toHaveValue("export TOKEN=migration-two");
    await page
      .getByLabel("Environment Setup Command", { exact: true })
      .fill("");
    await page.getByRole("button", { name: "Save setup command" }).click();
    await expect(
      page.getByText("Setup command saved for all repositories.")
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByLabel("Environment Setup Command", { exact: true })
    ).toHaveValue("");
    await page.goto("/compare");
    await expect(
      page.getByRole("button", { name: "Run Comparison" })
    ).toBeEnabled();
  } finally {
    database
      .prepare("DELETE FROM settings WHERE key IN (?, ?)")
      .run(
        "repository-config:migration-one",
        "repository-config:migration-two"
      );
    database.close();
  }
});
