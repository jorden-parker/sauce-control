# 08: Affected Page detection

**What to build:** A Comparison lists only the Pages that load a file changed between Base and Target. When source maps are missing, all Pages are listed and a banner says detection is off.

**Blocked by:** 07 (Page discovery)

**Status:** ready-for-agent

- [ ] Per Page, the loaded source modules are recorded via source maps
- [ ] Changed files come from the diff between Base Branch and Target Branch
- [ ] A Page is Affected when its modules intersect the changed files
- [ ] Missing source maps or non-module changes (CSS-only, config) fall back to all Pages and show the banner
- [ ] Comparison Runner tests with the fixture Repository assert the Affected Page set and the fallback; behaviour matches ADR 0002
