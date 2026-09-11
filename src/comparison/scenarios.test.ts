import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DEFAULT_CRAWL_LIMITS } from "@/crawler/crawl-limits";
import { fixtureDependencies } from "./fixtures/static-app";
import { runComparison } from "./run-comparison";

const withComparison = async (
  check: (
    comparison: Awaited<ReturnType<typeof runComparison>>,
    origin: string
  ) => Promise<void>
) => {
  const api = createServer((request, response) => {
    if (request.url === "/download") {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "x-file-name": "sample.bin",
      });
      response.end(Buffer.from([0, 255, 128, 65]));
      return;
    }
    response.writeHead(200, {
      "content-type": "application/json",
      "set-cookie": "credential=secret",
    });
    if (request.url?.startsWith("/scalar/")) {
      response.end(request.url === "/scalar/1" ? "12" : '"twelve"');
      return;
    }
    if (request.url?.startsWith("/catalog/")) {
      response.end(
        request.url === "/catalog/1"
          ? '{"items":[{"price":12,"label":"Tea"},{"price":2.5,"label":null}],"next":null}'
          : '{"items":[],"total":2}'
      );
      return;
    }
    response.end(
      request.url === "/users/2"
        ? '{"id":2,"name":"Grace"}'
        : '{"id":7,"name":"Ada"}'
    );
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(api.address() as AddressInfo).port}`,
    workDirectory = mkdtempSync(join(tmpdir(), "scenarios-")),
    comparison = await runComparison(
      { ...fixtureDependencies(), localEndpointOrigins: [origin] },
      {
        baseBranch: "main",
        targetBranch: "feature/login",
        repository: "web-app",
        organisation: "sauce-labs",
        runtime: "docker",
        sessionId: "scenario-test",
        token: "fixture",
        environment: {},
        workDirectory,
        readiness: { pollIntervalMs: 1, timeoutMs: 20 },
        config: {
          buildCommand: "",
          startCommand: "",
          port: 3000,
          useDotEnvLocal: false,
          crawl: DEFAULT_CRAWL_LIMITS,
          pages: { added: [], removed: [] },
        },
      }
    );
  try {
    await check(comparison, origin);
  } finally {
    await comparison.stop();
    await new Promise<void>((resolve) => api.close(() => resolve()));
    rmSync(workDirectory, { recursive: true, force: true });
  }
};

it("generates recorded responses from this Comparison's Base calls, excluding Target calls and credential headers", async () => {
  await withComparison(async (comparison, origin) => {
    await fetch(
      `${comparison.proxy.urlFor("target")}__sauce-control/endpoint?url=${encodeURIComponent(`${origin}/users/2`)}`
    );
    await fetch(
      `${comparison.proxy.urlFor("base")}__sauce-control/endpoint?url=${encodeURIComponent(`${origin}/users/7`)}`
    );
    const recorded = comparison
      .scenarios()
      .find((scenario) => scenario.name === "recorded");
    expect(recorded?.responses).toEqual([
      {
        endpoint: { method: "GET", origin, pathPattern: "/users/{n}" },
        body: '{"id":7,"name":"Ada"}',
        headers: { "content-type": "application/json" },
        status: 200,
        delayMs: 0,
      },
    ]);
  });
});

it("infers each Endpoint's JSON schema and derives empty, error, and slow responses", async () => {
  await withComparison(async (comparison, origin) => {
    await fetch(
      `${comparison.proxy.urlFor("base")}__sauce-control/endpoint?url=${encodeURIComponent(`${origin}/users/7`)}`
    );
    const scenarios = comparison.scenarios();
    expect(scenarios.map(({ name }) => name)).toEqual([
      "recorded",
      "empty",
      "error",
      "slow",
    ]);
    expect(scenarios[0]?.schemas).toEqual([
      {
        endpoint: { method: "GET", origin, pathPattern: "/users/{n}" },
        schema: {
          type: "object",
          properties: { id: { type: "integer" }, name: { type: "string" } },
          required: ["id", "name"],
        },
      },
    ]);
    expect(
      scenarios.find(({ name }) => name === "empty")?.responses[0]
    ).toMatchObject({ body: '{"id":0,"name":""}', status: 200, delayMs: 0 });
    expect(
      scenarios.find(({ name }) => name === "error")?.responses[0]
    ).toMatchObject({
      body: '{"error":"Scenario error"}',
      status: 500,
      delayMs: 0,
    });
    expect(
      scenarios.find(({ name }) => name === "slow")?.responses[0]
    ).toMatchObject({
      body: '{"id":7,"name":"Ada"}',
      status: 200,
      delayMs: 3000,
    });
  });
});

it("merges all Base samples and array items into a schema with optional fields and mixed types", async () => {
  await withComparison(async (comparison, origin) => {
    for (const path of ["/catalog/1", "/catalog/2"]) {
      // Samples are intentionally recorded in a known order.
      // eslint-disable-next-line no-await-in-loop
      await fetch(
        `${comparison.proxy.urlFor("base")}__sauce-control/endpoint?url=${encodeURIComponent(`${origin}${path}`)}`
      );
    }
    expect(comparison.scenarios()[0]?.schemas[0]?.schema).toEqual({
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["price", "label"],
            properties: {
              price: { type: "number" },
              label: { anyOf: [{ type: "string" }, { type: "null" }] },
            },
          },
        },
        next: { type: "null" },
        total: { type: "integer" },
      },
    });
    expect(
      comparison.scenarios().find(({ name }) => name === "empty")?.responses[0]
        ?.body
    ).toBe('{"items":[],"next":null,"total":0}');
  });
});

it("keeps non-JSON responses byte-for-byte for replay without inventing a schema", async () => {
  await withComparison(async (comparison, origin) => {
    await fetch(
      `${comparison.proxy.urlFor("base")}__sauce-control/endpoint?url=${encodeURIComponent(`${origin}/download`)}`
    );
    const recorded = comparison.scenarios()[0];
    expect(recorded?.schemas).toEqual([]);
    expect(recorded?.responses[0]).toMatchObject({
      body: new Uint8Array([0, 255, 128, 65]),
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "sample.bin",
      },
    });
  });
});

it("uses an observed type for empty values when an Endpoint returns mixed scalar types", async () => {
  await withComparison(async (comparison, origin) => {
    await fetch(
      `${comparison.proxy.urlFor("base")}__sauce-control/endpoint?url=${encodeURIComponent(`${origin}/scalar/1`)}`
    );
    await fetch(
      `${comparison.proxy.urlFor("base")}__sauce-control/endpoint?url=${encodeURIComponent(`${origin}/scalar/2`)}`
    );
    expect(
      comparison.scenarios().find(({ name }) => name === "empty")?.responses[0]
        ?.body
    ).toBe("0");
  });
});
