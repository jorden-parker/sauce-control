# 14: Shared Viewport toggle

**What to build:** One Viewport toggle resizes both the embedded Instances and the report captures, and both use the same device frame component.

**Blocked by:** 06 (Embedded Instances with interaction sync), 13 (Report UI)

**Status:** ready-for-agent

- [ ] A single Viewport toggle drives the embedded Instances and the report
- [ ] The device frame component from the report is reused for the embedded Instances
- [ ] Switching Viewport preserves sync state and the currently selected Page
- [ ] Playwright UI test asserts both surfaces resize together
