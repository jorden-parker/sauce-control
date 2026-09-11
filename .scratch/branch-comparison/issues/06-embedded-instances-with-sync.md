# 06: Embedded Instances with interaction sync

**What to build:** A reviewer sees both Instances embedded side by side. Navigating, clicking, typing, focusing, hovering, or scrolling in one is replayed in the other. When the sibling has no matching element, a desync badge appears.

**Blocked by:** 05 (Two Instances behind the Proxy)

**Status:** ready-for-agent

- [ ] Both Instances embedded in the UI inside device frames
- [ ] Injected sync script serialises navigation, click, input, focus, hover, and scroll events with a target descriptor
- [ ] Events are posted to the parent window and forwarded to the sibling frame
- [ ] Receiver resolves targets by accessibility role and name, then test id, then CSS path
- [ ] Desync badge shown when no strategy matches; no automatic repair attempted
- [ ] Playwright UI test with a fixture app covers each event type and the desync case
