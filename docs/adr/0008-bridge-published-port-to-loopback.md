---
status: accepted
---

# Bridge the published port to the development server's loopback

Publish a fixed bridge port (45173, or 45174 when the application uses 45173) from each development Instance instead of the application port, and have the development launcher relay connections from that port to the application port on the container's loopback, trying `127.0.0.1` and then `::1`.

Development servers such as Vite bind only to localhost by default. A published container port cannot reach a loopback-bound server, yet the in-container readiness check saw the port as listening, so the Instance came up unreachable: the Proxy answered 502, the Instance previews were blank, and no script carried a source map, which turned Affected Page detection off. Requiring reviewers to add `--host` to every dev script would push a container concern into each Repository; relaying inside the container keeps the dev script untouched, as ADR 0004 intends.

The readiness check keeps polling the application port. The bridge lives in the trusted launcher (ADR 0006), forwards bytes without inspecting them, and closes with the launcher.
