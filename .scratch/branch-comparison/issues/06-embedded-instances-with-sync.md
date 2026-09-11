# 06: Embedded Instances with interaction sync

**What to build:** A reviewer sees both Instances embedded side by side. Navigating, clicking, typing, focusing, hovering, or scrolling in one is replayed in the other. When the sibling has no matching element, a desync badge appears.

**Blocked by:** 05 (Two Instances behind the Proxy)

**Status:** in-review

- [x] Both Instances embedded in the UI inside device frames
- [x] Injected sync script serialises navigation, click, input, focus, hover, and scroll events with a target descriptor
- [x] Events are posted to the parent window and forwarded to the sibling frame
- [x] Receiver resolves targets by accessibility role and name, then test id, then CSS path
- [x] Desync badge shown when no strategy matches; no automatic repair attempted
- [x] Playwright UI test with a fixture app covers each event type and the desync case

## Comments

2026-09-11: Implemented test-first. Seams: the injected sync script (`src/sync/sync-script.ts`), tested by evaluating its source in a fresh JSDOM window per test and asserting what it posts to the parent and what a replayed message does to the page; the Proxy (`startProxy`), tested for the port-per-Instance routing and the sync injection; and the Compare page, tested with Playwright against the fixture app in `src/comparison/fixtures/sync-app.ts` served through the real Proxy under `SAUCE_CONTROL_COMPARISON=stub` (`e2e/embedded-instances.spec.ts`).

Proxy: resolves the open point from ticket 05 by giving each Instance its own loopback port at the root instead of a `/base/` or `/target/` prefix, so absolute links and `/_next/...` asset paths inside an embedded Instance keep working. The header route went with the prefix; `Proxy.port` became `Proxy.ports`. The sync script is injected as `<script data-sauce-control="sync">` after the determinism shims.

Sync script: written as one self-contained TypeScript function (`installSync`) serialised with `Function.prototype.toString`, so it is type-checked and unit-tested yet needs no bundling step; verified the minified production chunk still evaluates standalone. Serialises click, input (value, plus checked for checkbox and radio), focus, hover (once per element entered), scroll (element offsets, or the window), and navigation (`pushState`, `replaceState`, `popstate`, `hashchange`, as path plus query and hash). Targets carry the role and accessible name of the closest element with a role, the closest `data-testid`, and a CSS path from `<body>`. Roles come from `role` or the HTML implicit mapping; names from `aria-label`, `aria-labelledby`, `<label>`, `alt`, `value` for button inputs, text content, then `placeholder` or `title`. The receiver tries role and name, then test id, then CSS path, and posts `desync` when none match; nothing is repaired. Echo suppression: a `replaying` flag during synchronous replays, position matching for scroll (which fires later), and input replay is a no-op when the field already holds the value so a toggle is never flipped back.

UI: `EmbeddedInstances` (`src/app/compare/embedded-instances.tsx`) renders both Instances in `DeviceFrame` (`src/components/device-frame.tsx`, scales the Viewport to fit its column; ticket 14 reuses it) at a default Phone Viewport (`src/viewport/viewport.ts`), forwards each frame's events to the sibling with the sibling's origin as target, and shows a dismissable desync badge over the frame that reported it. Frames are identified by message origin only: Chromium stops reporting the iframe's `contentWindow` as `event.source` once a replayed click navigated it, which cost some debugging.

Playwright runs with one worker now: the app holds one Comparison per process, so files that start one cannot share the server.

Known limits: hover replay dispatches mouse events, so `:hover` styles do not follow; a navigation replay uses `pushState` plus `popstate`, which suits client-side routers but not apps that read `location` on load only; the fixture app is plain HTML, so React controlled inputs are exercised only through the prototype-setter path.
