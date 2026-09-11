---
status: accepted
---

# Capture Endpoint calls in the browser, not inside the container

ADR 0002 has the Proxy capture outbound traffic to discover Endpoints, and Scenarios later answer those calls from mocks. The Proxy only sits between the browser and each Instance, so it never sees a call the page makes to another host. We inject a script with the determinism shims that sends every cross-origin `fetch` and `XMLHttpRequest` to a route on the Instance's own Proxy port (`/__sauce-control/endpoint?url=…`); the Proxy makes the call from Node, answers the page, and records it. Calls the application makes from inside its container are not captured.

## Considered Options

- **Forward proxy for the container as well** (`HTTP_PROXY` / `HTTPS_PROXY` pointing at the host): HTTPS needs a certificate authority the container trusts to see anything but the host name, Node's `fetch` ignores those variables unless `NODE_USE_ENV_PROXY` is set, and the host's address differs between Docker Desktop, Colima, and Podman. Deferred until a Repository needs it.
- **Playwright request interception**: sees the crawl only, never the embedded Instances the reviewer drives.

## Consequences

- Server-side calls (server-side rendering, API routes that call out) are neither recorded nor mockable by a Scenario; both Instances still make them for real.
- Only `fetch` and `XMLHttpRequest` are rerouted; `WebSocket`, `EventSource`, `sendBeacon`, and resource loads are not.
- The route would otherwise let code under review read any local service, which the browser's same-origin rule normally prevents. The Proxy refuses targets on loopback, private, and link-local addresses with a 403, checking literal addresses before connecting and resolved names as the socket connects, so a DNS answer that changes after a check cannot slip through. A Repository whose browser code calls a backend on the reviewer's machine is not supported; the tests and the stub name their fixture API in `localEndpointOrigins`.
- An Endpoint's redirect is rewritten to point back at the route, so the browser follows it through the Proxy and each hop is checked and recorded.
- Every rerouted call is same-origin to the page, so CORS never applies; the Proxy origin's cookies are not forwarded to Endpoints and an Endpoint's `Set-Cookie` does not reach the browser, so cookie-based auth to another host does not work through the Proxy.
