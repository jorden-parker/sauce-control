# 08: Affected Page detection

**What to build:** A Comparison lists only the Pages that load a file changed between Base and Target. When source maps are missing, all Pages are listed and a banner says detection is off.

**Blocked by:** 07 (Page discovery)

**Status:** in-review

- [x] Per Page, the loaded source modules are recorded via source maps
- [x] Changed files come from the diff between Base Branch and Target Branch
- [x] A Page is Affected when its modules intersect the changed files
- [x] Missing source maps or non-module changes (CSS-only, config) fall back to all Pages and show the banner
- [x] Comparison Runner tests with the fixture Repository assert the Affected Page set and the fallback; behaviour matches ADR 0002

## Comments

2026-09-11: Implemented test-first at the Comparison Runner seam: `runComparison`, then `discoverPages`, then `detectAffectedPages` in `src/comparison/detect-affected-pages.ts`, driven by the fixture Repository behind the fake Container Runtime adapter with a real headless Chromium (`src/comparison/detect-affected-pages.test.ts`). The fixture gained a `src/` directory of modules and an `assets/` directory of built scripts carrying `sourceMappingURL` comments and maps; feature branches are now overlay directories holding only the files they change on top of `main`, so `feature/login` changes `src/about.ts` and adds `src/careers.ts`, and a new `feature/css-only` changes only `styles.css`. The fake git also answers `diff`, and `fixtureDependencies({ sourceMaps: false })` serves a build without maps.

Changed files (`src/instance/changed-files.ts`): the Base Branch is fetched into the Target Branch clone and `git diff --name-only --no-renames origin/<base>...HEAD` gives the paths from the merge base, so commits landed on the Base Branch since the fork do not count; a rename counts as both paths.

Loaded modules (`src/crawler/loaded-modules.ts`, `src/crawler/source-map.ts`): every discovered Page is loaded fresh in both Instances through the Proxy; each script and stylesheet response is checked for a `SourceMap` header or a `sourceMappingURL` comment (external or `data:`), the map (plain or indexed) is parsed, and its sources become module paths with bundler schemes and namespaces removed (`webpack://`, `turbopack:///[project]/`, `file://`) and `node_modules` dropped. A changed file matches a module when it ends the module path at a segment boundary, so the container's working directory prefix does not matter.

Rules: a Page is Affected when any of its modules matches a changed file. Every Page is listed, with the banner, when no resource of any Page carried a source map (`missing-source-maps`) or when no changed file matches any module (`non-module-changes`: a stylesheet-only or config-only change). Otherwise the result also names the changed files no Page loads (`unattributed`), and the Compare page shows them under the list so a server-side or config change alongside a module change is never silent. The Compare page lists only the Affected Pages and their Page States, shows a "Detecting the Affected Pages of …" stage, and the stub Comparison (no source maps, no clones) shows the banner, which the Playwright run asserts.

Known limits: a changed file that no Page loads as a module (server code, data fetching, config) does not mark any Page when some other changed file does match, it is only named under the list; modules are recorded from a fresh load plus up to five seconds of network idle, so a chunk loaded on a later interaction is missed, and Page States inherit their Page's verdict; stylesheets count only when the build serves a map for them.
