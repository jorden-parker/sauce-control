# 12: Capture and diff with Viewports

**What to build:** A reviewer picks Viewports, presses Run, watches progress stages, and the tool captures every Page and Page State on both Instances at each Viewport and computes pixel diffs.

**Blocked by:** 07 (Page discovery)

**Status:** ready-for-agent

- [ ] Viewport presets (mobile, tablet, desktop) plus user-defined sizes, selectable per Comparison
- [ ] Run button starts the Comparison; stages clone, build, crawl, capture, diff shown with the current one highlighted
- [ ] Playwright screenshots per Page or Page State, Viewport, and Instance
- [ ] Pixel diff produces a changed-pixel percentage and a magenta overlay image
- [ ] Images stored on disk keyed by content hash; Comparison and Capture Pairs stored in SQLite and kept as history
- [ ] Comparison Runner tests assert Capture Pairs and diff percentages for the fixture
