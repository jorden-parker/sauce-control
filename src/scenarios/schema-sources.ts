import type { JsonSchema } from "./json-schema";

export interface SchemaSource {
  name: string;
  document: unknown;
}

const object = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {},
  /** Resolve only document-local references, with bounded recursion for recursive schemas. */
  resolve = (value: unknown, document: unknown, depth = 0): unknown => {
    if (depth > 30) {
      return {};
    }
    if (Array.isArray(value)) {
      return value.map((item) => resolve(item, document, depth + 1));
    }
    if (typeof value !== "object" || value === null) {
      return value;
    }
    const record = object(value);
    if (typeof record.$ref === "string") {
      if (!record.$ref.startsWith("#/")) {
        return {};
      }
      const target = record.$ref
        .slice(2)
        .split("/")
        .reduce<unknown>(
          (node, key) =>
            object(node)[key.replaceAll("~1", "/").replaceAll("~0", "~")],
          document
        );
      return resolve(target, document, depth + 1);
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [
        key,
        resolve(item, document, depth + 1),
      ])
    );
  };

/** Match the HTTP method and path; Schema Source server hosts do not participate. */
export const contractSchema = (
  sources: SchemaSource[],
  method: string,
  path: string
): JsonSchema | undefined => {
  for (const source of sources) {
    const document = object(resolve(source.document, source.document));
    for (const [pattern, item] of Object.entries(
      object(document.paths)
    ).toSorted(
      ([left], [right]) =>
        (left.match(/\{/gu)?.length ?? 0) - (right.match(/\{/gu)?.length ?? 0)
    )) {
      const parts = pattern.split("/"),
        actual = path.split("/");
      if (
        parts.length !== actual.length ||
        !parts.every(
          (part, index) => /^\{[^}]+\}$/u.test(part) || part === actual[index]
        )
      ) {
        continue;
      }
      const operation = object(object(item)[method.toLowerCase()]),
        responses = object(operation.responses),
        success = Object.keys(responses).find((status) =>
          /^2\d\d$/u.test(status)
        ),
        response = object(responses[success ?? "default"]),
        schema = object(
          response.schema ??
            object(object(response.content)["application/json"]).schema
        );
      if (Object.keys(schema).length > 0) {
        return schema as JsonSchema;
      }
    }
  }
  return undefined;
};
