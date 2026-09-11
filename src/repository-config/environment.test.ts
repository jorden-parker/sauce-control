import { describe, expect, it } from "vitest";
import { parseEnvironment } from "./environment";

describe("pasted environment variables", () => {
  it("reads KEY=value lines, ignoring comments, blanks, an export prefix, and surrounding quotes", () => {
    expect(
      parseEnvironment(`# API
API_URL=https://api.example.test
export SECRET="s3cr3t=with=equals"

TOKEN='single'
INVALID LINE
`)
    ).toEqual({
      API_URL: "https://api.example.test",
      SECRET: "s3cr3t=with=equals",
      TOKEN: "single",
    });
  });
});
