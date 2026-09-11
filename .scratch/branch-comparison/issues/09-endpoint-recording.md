# 09: Endpoint recording

**What to build:** While an Instance is used or crawled, the tool records every outbound Endpoint it calls and the responses, with credentials stripped. A reviewer sees the list, a warning about personal data, and a purge button.

**Blocked by:** 05 (Two Instances behind the Proxy)

**Status:** in-review

- [x] Proxy captures outbound HTTP requests and responses from both Instances
- [x] `Authorization` and `Cookie` headers are always redacted before storage
- [x] Endpoints listed in the UI per Repository with method, path pattern, and sample count
- [x] Warning that recordings may contain personal data and a purge button that deletes them
- [x] Proxy tests cover capture, redaction, and purge

## Comments

2026-09-11: Implemented test-first at three seams agreed before any test was written: the Proxy over HTTP, driven by a real headless Chromium against a fixture external API (`src/proxy/proxy.test.ts`); the Endpoint recording store (`src/endpoints/endpoint-recordings.test.ts`); and the Repository Config page in Playwright (`e2e/endpoint-recording.spec.ts`). Capture and redaction are Proxy tests; purge is covered by the store test and the Playwright run rather than a Proxy test, since the Proxy only records.

Capture (`src/proxy/injection.ts`, `src/proxy/proxy.ts`): the Proxy injects an `endpoints` script that sends every cross-origin `fetch` and `XMLHttpRequest` to `/__sauce-control/endpoint?url=<encoded URL>` on the Instance's own Proxy port. The Proxy calls the Endpoint from Node, answers the page with the response, and hands the call (role, method, URL, forwarded headers, both bodies, status, response headers) to the `recordEndpoint` option. Same-origin requests are the application's own routes and go straight through. The Proxy origin's `Cookie` header is never forwarded to an Endpoint, and an Endpoint's `Set-Cookie` never reaches the browser; `Authorization` is forwarded so the call still works. The page gets its response before the call is recorded, and a recording that fails is logged rather than breaking the page. Targets on loopback, private, or link-local addresses are refused with a 403 (literal addresses before connecting, resolved names as the socket connects), so code under review cannot use the route to read local services; `localEndpointOrigins` names the exceptions, which only the tests and the stub's fixture API use. An Endpoint's redirect is rewritten to point back at the route, so each hop is checked and recorded. See ADR 0005.

Storage (`src/endpoints/endpoint-recordings.ts`): one row per call in `endpoint-recordings.db` in the data directory, keyed by Repository. `record` replaces the values of `Authorization`, `Proxy-Authorization`, `Cookie`, and `Set-Cookie` (any case) with `[redacted]`, so no caller can store them. `endpoints(repository)` groups calls by method, origin, and path pattern (`{n}` for numeric segments, `{uuid}` for UUIDs), `samples(repository)` returns the stored calls oldest first for ticket 10, and `purge(repository)` deletes them.

Wiring and UI: `runComparison` takes an optional `recordings` dependency and records under the Comparison's Repository; the stub Comparison serves a fixture API that the fixture app's home page calls on load, so crawling records it. The Repository Config page gains an Endpoints card listing method, origin and path pattern, and sample count, with the personal-data warning and a Purge recordings button.

Known limits: calls made inside the container (server-side rendering, API routes calling out) are not captured, only browser `fetch` and `XMLHttpRequest` (not `WebSocket`, `EventSource`, `sendBeacon`, or resource loads such as `<img>`). An application that relies on cookies for an API on another host (`credentials: "include"`) loses them, and one whose browser code calls a backend on the reviewer's machine or private network is refused. Credentials in query strings or bodies are stored as sent; only headers are redacted. Recordings have no size or age cap.
