import { expect, test } from "@playwright/test";

const contract = JSON.stringify({
  info: { title: "Users", version: "1" },
  openapi: "3.0.3",
  paths: {
    "/users/{id}": {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  properties: {
                    fullName: { type: "string" },
                    roles: { items: { type: "string" }, type: "array" },
                  },
                  type: "object",
                },
              },
            },
            description: "User",
          },
        },
      },
    },
  },
});

test("reviewer uploads a Schema Source and both Instances use its contract", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("Organisation").fill("sauce-labs");
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await page.goto("/repositories/web-app");
  await page.getByLabel("Upload Schema Source").setInputFiles({
    buffer: Buffer.from(contract),
    mimeType: "application/json",
    name: "openapi.json",
  });
  await page.getByRole("button", { name: "Attach upload" }).click();
  await expect(page.getByTestId("schema-source-list")).toContainText(
    "openapi.json"
  );
  await page.reload();
  await expect(page.getByTestId("schema-source-list")).toContainText(
    "openapi.json"
  );
  await page.goto("/compare");
  await page.getByRole("combobox", { exact: true, name: "Repository" }).click();
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
        ).toHaveText('{"fullName":"","roles":[]}');
      })
    );
  } finally {
    await page.getByRole("button", { name: "Stop Comparison" }).click();
  }
});

test("reviewer attaches a YAML Schema Source by URL and sees invalid-document errors", async ({
  page,
}) => {
  const { createServer } = await import("node:http"),
    server = createServer((request, response) => {
      response.end(
        request.url === "/invalid"
          ? "not an OpenAPI document"
          : "openapi: 3.0.3\ninfo:\n  title: URL contract\n  version: '1'\npaths: {}\n"
      );
    });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as import("node:net").AddressInfo,
    url = `http://127.0.0.1:${address.port}/openapi.yaml`;
  try {
    await page.goto("/repositories/web-app");
    await page.getByLabel("Schema Source URL").fill(url);
    await page.getByRole("button", { name: "Attach URL" }).click();
    await expect(page.getByTestId("schema-source-list")).toContainText(url);
    await page.reload();
    await expect(page.getByTestId("schema-source-list")).toContainText(url);
    await page
      .getByLabel("Schema Source URL")
      .fill(`http://127.0.0.1:${address.port}/invalid`);
    await page.getByRole("button", { name: "Attach URL" }).click();
    await expect(page.getByRole("status")).toContainText("valid OpenAPI");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("reviewer attaches a Schema Source from a named Repository in the Organisation", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("Organisation").fill("sauce-labs");
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await page.goto("/repositories/web-app");
  await expect(page.getByLabel("Schema Source Repository")).toBeVisible();
  await page.getByLabel("Schema Source Repository").fill("sauce-labs/docs");
  await page.getByLabel("Schema Source path").fill("openapi.yaml");
  await page.getByRole("button", { name: "Attach Repository source" }).click();
  await expect(page.getByTestId("schema-source-list")).toContainText(
    "sauce-labs/docs/openapi.yaml"
  );
  await page.reload();
  await expect(page.getByTestId("schema-source-list")).toContainText(
    "sauce-labs/docs/openapi.yaml"
  );
  await page.getByLabel("Schema Source Repository").fill("another-org/docs");
  await page.getByLabel("Schema Source path").fill("openapi.yaml");
  await page.getByRole("button", { name: "Attach Repository source" }).click();
  await expect(page.getByRole("status")).toContainText("saved Organisation");
});

test("reviewer detects local contracts in the Code Directory without importing dependencies or symlinks", async ({
  page,
}) => {
  const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } =
      await import("node:fs"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path"),
    directory = mkdtempSync(join(tmpdir(), "schema-detection-"));
  mkdirSync(join(directory, "other-api"));
  mkdirSync(join(directory, "node_modules"));
  writeFileSync(
    join(directory, "other-api", "swagger.yaml"),
    "swagger: '2.0'\ninfo: {title: Local, version: '1'}\npaths: {}\n"
  );
  writeFileSync(join(directory, "node_modules", "openapi.json"), contract);
  symlinkSync(
    join(directory, "other-api", "swagger.yaml"),
    join(directory, "openapi.yaml")
  );
  try {
    await page.goto("/repositories/web-app");
    await expect(page.getByLabel("Code Directory")).toBeVisible();
    await page.getByLabel("Code Directory").fill(directory);
    await page.getByRole("button", { name: "Detect Schema Sources" }).click();
    const sources = page.getByTestId("schema-source-list");
    await expect(sources).toContainText(
      join(directory, "other-api", "swagger.yaml")
    );
    await expect(sources).not.toContainText("node_modules");
    await expect(sources).not.toContainText(join(directory, "openapi.yaml"));
    await page.reload();
    await expect(page.getByLabel("Code Directory")).toHaveValue(directory);
    await expect(sources).toContainText("swagger.yaml");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("reviewer saves, reopens and edits a manual Scenario then runs it in both Instances", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("Organisation").fill("sauce-labs");
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await page.goto("/repositories/web-app");
  await expect(page.getByLabel("Scenario name")).toBeVisible();
  await page.getByLabel("Scenario name").fill("suspended");
  await page.getByLabel("Endpoint path pattern").fill("/users/{id}");
  await page.getByLabel("Response status").fill("403");
  await page.getByLabel("Response body").fill('{"reason":"Suspended"}');
  await page
    .getByRole("button", { exact: true, name: "Save Scenario" })
    .click();
  await expect(page.getByTestId("manual-scenario-message")).toHaveText(
    "Scenario saved."
  );
  await page.reload();
  await page.getByLabel("Edit Scenario").selectOption("suspended");
  await expect(page.getByLabel("Response body")).toHaveValue(
    '{"reason":"Suspended"}'
  );
  await page.getByLabel("Response body").fill('{"reason":"Account paused"}');
  await page
    .getByRole("button", { exact: true, name: "Save Scenario" })
    .click();
  await expect(page.getByTestId("manual-scenario-message")).toHaveText(
    "Scenario saved."
  );
  await page.goto("/compare");
  await page.getByRole("combobox", { exact: true, name: "Repository" }).click();
  await page.getByRole("option", { name: "web-app" }).click();
  await page.getByRole("combobox", { name: "Target Branch" }).click();
  await page.getByRole("option", { name: "feature/login" }).click();
  await page.getByRole("button", { name: "Save Comparison" }).click();
  await page.getByLabel("Scenario", { exact: true }).selectOption("suspended");
  await page.getByRole("button", { name: "Run Comparison" }).click();
  try {
    await expect(page.getByTestId("comparison-status")).toContainText(
      "Active Scenario: suspended",
      { timeout: 30_000 }
    );
    await Promise.all(
      ["Base Instance", "Target Instance"].map(async (title) => {
        await expect(
          page
            .frameLocator(`iframe[title="${title}"]`)
            .getByTestId("endpoint-response")
        ).toHaveText('{"reason":"Account paused"}');
      })
    );
  } finally {
    await page.getByRole("button", { name: "Stop Comparison" }).click();
  }
});
