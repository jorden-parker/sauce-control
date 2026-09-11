/** The JSON Schema vocabulary inferred from observed response bodies. */
export interface JsonSchema {
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  type?:
    | "null"
    | "boolean"
    | "integer"
    | "number"
    | "string"
    | "array"
    | "object";
}

/** Combine observations; only properties present in both samples remain required. */
export const mergeSchemas = (
  left: JsonSchema,
  right: JsonSchema
): JsonSchema => {
  if (Object.keys(left).length === 0) return right;
  if (Object.keys(right).length === 0) return left;
  if (left.type === "object" && right.type === "object") {
    const a = left.properties ?? {},
      b = right.properties ?? {};
    return {
      type: "object",
      properties: Object.fromEntries(
        [...new Set([...Object.keys(a), ...Object.keys(b)])].map((key) => [
          key,
          mergeSchemas(a[key] ?? {}, b[key] ?? {}),
        ])
      ),
      required: (left.required ?? []).filter((key) =>
        right.required?.includes(key)
      ),
    };
  }
  if (left.type === "array" && right.type === "array")
    return {
      type: "array",
      items: mergeSchemas(left.items ?? {}, right.items ?? {}),
    };
  if (left.type !== undefined && left.type === right.type) return left;
  if (
    [left.type, right.type].every(
      (type) => type === "integer" || type === "number"
    )
  )
    return { type: "number" };
  const alternatives: JsonSchema[] = [];
  for (const schema of [
    ...(left.anyOf ?? [left]),
    ...(right.anyOf ?? [right]),
  ]) {
    const index = alternatives.findIndex(
      (item) =>
        item.type === schema.type ||
        [item.type, schema.type].every(
          (type) => type === "integer" || type === "number"
        )
    );
    if (index === -1) alternatives.push(schema);
    else alternatives[index] = mergeSchemas(alternatives[index]!, schema);
  }
  return { anyOf: alternatives };
};

export const inferSchema = (value: unknown): JsonSchema => {
  if (value === null) return { type: "null" };
  if (Array.isArray(value))
    return {
      type: "array",
      items: value.map(inferSchema).reduce(mergeSchemas, {}),
    };
  if (typeof value === "object") {
    return {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, inferSchema(item)])
      ),
      required: Object.keys(value),
    };
  }
  if (typeof value === "number")
    return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  return { type: "string" };
};

/** Empty collections and scalar defaults retain the observed object's shape. */
export const emptyValue = (schema: JsonSchema): unknown => {
  if (schema.anyOf?.[0] !== undefined) return emptyValue(schema.anyOf[0]);
  switch (schema.type) {
    case "array":
      return [];
    case "object":
      return Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([key, property]) => [
          key,
          emptyValue(property),
        ])
      );
    case "string":
      return "";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    default:
      return null;
  }
};
