import { describe, expect, it } from "vitest";
import {
  type EndpointCall,
  openEndpointRecordings,
} from "./endpoint-recordings";

/** One call an Instance made, answered with a small JSON body. */
const call = (
  method: string,
  url: string,
  role: EndpointCall["role"] = "base"
): EndpointCall => ({
  method,
  requestBody: new Uint8Array(),
  requestHeaders: { accept: "application/json" },
  responseBody: new TextEncoder().encode('{"ok":true}'),
  responseHeaders: { "content-type": "application/json" },
  role,
  status: 200,
  url,
});

describe("storing a recorded call", () => {
  it("keeps the call but never the Authorization or Cookie header values", () => {
    const recordings = openEndpointRecordings(":memory:");
    recordings.record("web-app", {
      ...call("POST", "https://api.example.test/users"),
      requestBody: new TextEncoder().encode('{"name":"Ada"}'),
      requestHeaders: {
        Authorization: "Bearer secret-token",
        "content-type": "application/json",
        cookie: "session=cookie-secret",
      },
      status: 201,
    });

    const [sample, ...rest] = recordings.samples("web-app");
    expect(rest).toEqual([]);
    expect(sample).toMatchObject({
      method: "POST",
      requestHeaders: {
        Authorization: "[redacted]",
        "content-type": "application/json",
        cookie: "[redacted]",
      },
      responseHeaders: { "content-type": "application/json" },
      role: "base",
      status: 201,
      url: "https://api.example.test/users",
    });
    expect(Buffer.from(sample!.requestBody).toString()).toBe('{"name":"Ada"}');
    expect(Buffer.from(sample!.responseBody).toString()).toBe('{"ok":true}');
    expect(Date.parse(sample!.recordedAt)).not.toBeNaN();
  });
});

describe("purging recordings", () => {
  it("deletes every call recorded for one Repository and leaves the others", () => {
    const recordings = openEndpointRecordings(":memory:");
    recordings.record(
      "web-app",
      call("GET", "https://api.example.test/users/7")
    );
    recordings.record(
      "web-app",
      call("GET", "https://api.example.test/users/8", "target")
    );
    recordings.record(
      "other-app",
      call("GET", "https://api.example.test/teams")
    );

    expect(recordings.purge("web-app")).toBe(2);

    expect(recordings.endpoints("web-app")).toEqual([]);
    expect(recordings.samples("web-app")).toEqual([]);
    expect(recordings.endpoints("other-app")).toEqual([
      {
        method: "GET",
        origin: "https://api.example.test",
        pathPattern: "/teams",
        samples: 1,
      },
    ]);
  });
});

describe("listing recorded Endpoints", () => {
  it("groups calls by method, origin, and path pattern, counting the samples of each", () => {
    const recordings = openEndpointRecordings(":memory:");
    recordings.record(
      "web-app",
      call("GET", "https://api.example.test/users/7")
    );
    recordings.record(
      "web-app",
      call("GET", "https://api.example.test/users/42?expand=teams", "target")
    );
    recordings.record(
      "web-app",
      call(
        "GET",
        "https://api.example.test/orders/3f2c1a9e-5b7d-4c8e-9f01-23456789abcd/items"
      )
    );
    recordings.record(
      "web-app",
      call("POST", "https://api.example.test/users")
    );
    recordings.record(
      "web-app",
      call("GET", "https://cdn.example.test/users/7")
    );
    recordings.record(
      "other-app",
      call("GET", "https://api.example.test/users/7")
    );

    expect(recordings.endpoints("web-app")).toEqual([
      {
        method: "GET",
        origin: "https://api.example.test",
        pathPattern: "/orders/{uuid}/items",
        samples: 1,
      },
      {
        method: "POST",
        origin: "https://api.example.test",
        pathPattern: "/users",
        samples: 1,
      },
      {
        method: "GET",
        origin: "https://api.example.test",
        pathPattern: "/users/{n}",
        samples: 2,
      },
      {
        method: "GET",
        origin: "https://cdn.example.test",
        pathPattern: "/users/{n}",
        samples: 1,
      },
    ]);
  });
});
