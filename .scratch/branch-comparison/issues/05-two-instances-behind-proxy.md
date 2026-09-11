# 05: Two Instances behind the Proxy

**What to build:** A reviewer runs a Comparison and both Base and Target Instances come up, each reachable through the tool's Proxy. Logging in on one applies to the other. Timestamps and random values are identical across both. Animations are disabled.

**Blocked by:** 04 (Build and run one Instance)

**Status:** in-review

- [x] Both branches built and run concurrently, each on `localhost:3000` in its own container
- [x] Proxy routes to either Instance by path or header and rewrites HTML to inject scripts
- [x] One shared cookie jar across both Instances
- [x] Injected deterministic `Date.now` and seeded `Math.random`
- [x] Injected stylesheet disables CSS animations and transitions
- [x] Proxy tests run against a fixture upstream and cover routing, injection, cookie sharing, and the determinism shims

## Comments

2026-09-11: Implemented test-first. Seams: `startProxy` (`src/proxy/proxy.ts`), tested as a plain HTTP server against fixture upstreams, and `runComparison` (`src/comparison/run-comparison.ts`), tested with a fake Container Runtime whose containers only start once both branches have asked, so a sequential runner would hang.

Proxy: routes by path prefix (`/base/...`, `/target/...`, prefix stripped) or by the `x-sauce-control-instance` header, answers 404 with guidance otherwise, and forwards `Host: localhost:3000` so each Instance sees the origin it expects (ADR 0001). Requests go upstream with `Accept-Encoding: identity` so HTML can be rewritten. HTML responses get a `<script data-sauce-control="determinism">` and `<style data-sauce-control="animations">` inserted at the top of `<head>` (or before everything when there is none), with `Content-Length` recomputed; other content types stream through untouched. The determinism script replaces `Date` with a subclass-compatible constructor frozen at 2024-01-15T12:00:00Z for `Date.now()` and `new Date()` while explicit dates still work, and seeds `Math.random` with mulberry32; the tests execute the injected script in a fresh `node:vm` realm and assert both Instances draw the same sequence. The stylesheet disables animations, transitions, smooth scrolling, and the caret. One `CookieJar` per Proxy stores `Set-Cookie` from either Instance by name, honours `Max-Age=0` and past `Expires`, sends the jar as `Cookie` to both upstreams, and strips `Set-Cookie` from what the browser sees, so the browser never routes cookies by prefix.

Runner: clones, builds, and starts both branches with `Promise.allSettled`; when one fails, the Instance that did come up is removed and the error rethrown. `stop()` closes the Proxy and removes both containers. Smoke test `run-comparison.smoke.test.ts` runs two fixture containers on the real runtime and fetches each through the Proxy; passed on Docker via Colima, Podman skipped on this machine.

UI: the Compare page gains a Run card once a Comparison is saved. `startCurrentComparison` gathers the selection, Repository Config, keychain environment, Code Directory, chosen runtime, and GitHub token, starts in the background, and the panel polls until both Instances are up, then shows the Base and Target Proxy links and a Stop button. Errors (no runtime, no config, build failure) show inline. `SAUCE_CONTROL_COMPARISON=stub` replaces the runner in Playwright; covered by `e2e/run-comparison.spec.ts`.

Open points for ticket 06: the path-prefix routing means absolute links inside an embedded Instance (`/about`) lose their prefix; the embed will need either link rewriting in the injected script or a routing cookie the Proxy sets on the browser. The ticket 04 note about applications binding `localhost` only inside the container still stands.
