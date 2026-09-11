import { parse } from "yaml";
import type { SchemaSource } from "./schema-sources";

/** JSON is a YAML subset. Keep parsing errors out of the UI because they quote file content. */
export const readSchemaSource = (name: string, text: string): SchemaSource => {
  if (Buffer.byteLength(text) > 750_000) {
    throw new Error("Schema Source is too large.");
  }
  const document: unknown = parse(text, {
    logLevel: "silent",
    maxAliasCount: 50,
  });
  if (
    typeof document !== "object" ||
    document === null ||
    !("paths" in document) ||
    typeof document.paths !== "object" ||
    document.paths === null ||
    Array.isArray(document.paths) ||
    !(
      ("openapi" in document && String(document.openapi).startsWith("3.")) ||
      ("swagger" in document && document.swagger === "2.0")
    )
  ) {
    throw new Error("Choose a valid OpenAPI document.");
  }
  return { document, name };
};
