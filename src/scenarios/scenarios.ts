import { type SchemaSource, contractSchema } from "./schema-sources";
import type { EndpointCall } from "@/endpoints/endpoint-recordings";
import { endpointPathPattern } from "@/endpoints/endpoint-recordings";
import {
  type JsonSchema,
  emptyValue,
  inferSchema,
  mergeSchemas,
} from "./json-schema";

export interface ScenarioResponse {
  body: string | Uint8Array;
  delayMs: number;
  endpoint: { method: string; origin: string; pathPattern: string };
  headers: Record<string, string>;
  status: number;
}

export interface ManualScenario {
  name: string;
  responses: (Omit<ScenarioResponse, "endpoint" | "body"> & {
    method: string;
    pathPattern: string;
    body: string;
  })[];
}

export interface Scenario {
  name: string;
  responses: ScenarioResponse[];
  schemas: { endpoint: ScenarioResponse["endpoint"]; schema: JsonSchema }[];
}

const OMITTED_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "connection",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "date",
]);

/** Current Comparison's Base responses only; response credentials are never retained. */
export const createScenarioCollection = (
  schemaSources: SchemaSource[] = [],
  manualScenarios: ManualScenario[] = []
) => {
  const responses = new Map<string, ScenarioResponse>(),
    inferred = new Map<string, JsonSchema>();
  return {
    record: (call: EndpointCall): void => {
      if (call.role !== "base") {
        return;
      }
      const url = new URL(call.url),
        endpoint = {
          method: call.method,
          origin: url.origin,
          pathPattern: endpointPathPattern(url.pathname),
        },
        key = JSON.stringify(endpoint),
        bytes = Buffer.from(call.responseBody),
        text = bytes.toString("utf8");
      try {
        inferred.set(
          key,
          mergeSchemas(
            inferred.get(key) ?? {},
            inferSchema(
              JSON.parse(Buffer.from(call.responseBody).toString("utf8"))
            )
          )
        );
      } catch {
        /* Non-JSON responses can be replayed without an inferred schema. */
      }
      if (!responses.has(key)) {
        responses.set(key, {
          body: Buffer.from(text).equals(bytes) ? text : new Uint8Array(bytes),
          delayMs: 0,
          endpoint,
          headers: Object.fromEntries(
            Object.entries(call.responseHeaders).flatMap(([name, value]) =>
              value === undefined || OMITTED_HEADERS.has(name.toLowerCase())
                ? []
                : [
                    [
                      name.toLowerCase(),
                      Array.isArray(value) ? value.join(", ") : value,
                    ],
                  ]
            )
          ),
          status: call.status,
        });
      }
    },
    scenarios: (): Scenario[] => {
      const recorded = [...responses.values()],
        schemas = recorded.flatMap(({ endpoint }) => {
          const schema =
            contractSchema(
              schemaSources,
              endpoint.method,
              endpoint.pathPattern
            ) ?? inferred.get(JSON.stringify(endpoint));
          return schema === undefined ? [] : [{ endpoint, schema }];
        }),
        empty = recorded.map((response) => {
          const entrySchema = schemas.find(
            ({ endpoint }) =>
              JSON.stringify(endpoint) === JSON.stringify(response.endpoint)
          );
          return entrySchema === undefined
            ? response
            : {
                ...response,
                body: JSON.stringify(emptyValue(entrySchema.schema)),
              };
        });
      return [
        ...manualScenarios.map((manual) => ({
          name: manual.name,
          responses: recorded.map((response) => {
            const edit = manual.responses.find((candidate) => {
              const parts = candidate.pathPattern.split("/"),
                actual = response.endpoint.pathPattern.split("/");
              return (
                candidate.method === response.endpoint.method &&
                parts.length === actual.length &&
                parts.every(
                  (part, index) =>
                    /^\{[^}]+\}$/u.test(part) || part === actual[index]
                )
              );
            });
            return edit === undefined
              ? response
              : {
                  body: edit.body,
                  delayMs: edit.delayMs,
                  endpoint: response.endpoint,
                  headers: edit.headers,
                  status: edit.status,
                };
          }),
          schemas,
        })),
        { name: "recorded", responses: recorded, schemas },
        { name: "empty", responses: empty, schemas },
        {
          name: "error",
          responses: recorded.map((response) => ({
            ...response,
            body: '{"error":"Scenario error"}',
            headers: { "content-type": "application/json" },
            status: 500,
          })),
          schemas,
        },
        {
          name: "slow",
          responses: recorded.map(({ body, endpoint, headers, status }) => ({
            body,
            delayMs: 3000,
            endpoint,
            headers,
            status,
          })),
          schemas,
        },
      ];
    },
  };
};
