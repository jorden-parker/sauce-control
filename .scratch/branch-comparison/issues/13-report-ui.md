# 13: Report UI

**What to build:** A reviewer opens a finished Comparison and sees the Affected Pages, expands one, toggles Viewport and Scenario, and views each Capture Pair side by side, as a magenta overlay, or with a slider, inside a device frame. Past Comparisons are listed.

**Blocked by:** 12 (Capture and diff with Viewports)

**Status:** ready-for-agent

- [ ] Report lists Affected Pages (or all Pages with the banner) with changed-pixel percentage per row
- [ ] Row expands to Viewport and Scenario toggles
- [ ] Side-by-side, overlay, and slider views for each Capture Pair
- [ ] Device frame component renders captures at the Viewport's size
- [ ] History list of past Comparisons per Repository
- [ ] Playwright UI test with the Comparison Runner stubbed covers the three views and the toggles
