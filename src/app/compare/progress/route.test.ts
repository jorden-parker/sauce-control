import { afterEach, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
  snapshot: { progress: { id: "attempt-one" }, status: { kind: "starting" } },
}));
vi.mock("@/comparison/current-comparison", () => ({
  currentComparisonSnapshot: () => store.snapshot,
  subscribeComparison: (listener: () => void) => {
    store.listeners.add(listener);
    return () => store.listeners.delete(listener);
  },
}));
import { GET } from "./route";
afterEach(() => {
  expect(store.listeners.size).toBe(0);
});
it("sends current state on connection, pushes changes, and unsubscribes without cancelling startup", async () => {
  const response = GET(new Request("http://localhost/compare/progress"));
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  const reader = response.body!.getReader(),
    decode = new TextDecoder();
  expect(decode.decode((await reader.read()).value)).toContain("attempt-one");
  store.snapshot.status.kind = "running";
  for (const listener of store.listeners) {
    listener();
  }
  expect(decode.decode((await reader.read()).value)).toContain("running");
  await reader.cancel();
  const reconnected = GET(
    new Request("http://localhost/compare/progress")
  ).body!.getReader();
  expect(decode.decode((await reconnected.read()).value)).toContain("running");
  await reconnected.cancel();
});
it("releases the subscription when the request aborts", async () => {
  const controller = new AbortController(),
    reader = GET(
      new Request("http://localhost/compare/progress", {
        signal: controller.signal,
      })
    ).body!.getReader();
  await reader.read();
  controller.abort();
  expect((await reader.read()).done).toBe(true);
});
it("rejects cross-origin subscriptions", () => {
  expect(
    GET(
      new Request("http://localhost/compare/progress", {
        headers: { origin: "https://elsewhere.test" },
      })
    ).status
  ).toBe(403);
});
