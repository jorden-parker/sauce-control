# 07: Page discovery

**What to build:** After Instances start, the tool discovers the application's Pages from the sitemap and by crawling the accessibility tree, including modals and tabs as Page States. A reviewer can bound the crawl per Repository and add or remove Pages by hand.

**Blocked by:** 05 (Two Instances behind the Proxy)

**Status:** in-review

- [x] Seeds from `sitemap.xml` when present
- [x] Crawls by clicking accessibility-tree nodes with roles `link`, `button`, `menuitem`, `tab`, and `option`, so react-aria apps are covered
- [x] URL changes become Pages; non-navigating changes become Page States with the interaction sequence to reach them
- [x] Crawl depth, page limit, query stripping, and numeric-segment collapsing configurable per Repository with the agreed defaults
- [x] Pages can be added or removed manually and persist with the Repository
- [x] Comparison Runner seam established: fixture Repository with two branches plus a fake Container Runtime adapter; tests assert the discovered Pages and Page States

## Comments

2026-09-11: Implemented test-first. Seams: the Comparison Runner (`runComparison` then `discoverPages` in `src/comparison/discover-pages.ts`), driven by the fixture Repository in `src/comparison/fixtures/static-app/` (two branch directories: `main` with a sitemap, links, tabs, a dialog, and a menu; `feature/login` changes `about.html` and adds `/careers`) behind a fake Container Runtime adapter that serves a branch's build context over HTTP (`src/comparison/fixtures/static-app.ts`), with a real headless Chromium crawling through the real Proxy (`src/comparison/discover-pages.test.ts`); the settings store for persistence; and the Repository Config and Compare pages with Playwright (`e2e/repository-config.spec.ts`, `e2e/run-comparison.spec.ts`).

Crawler (`src/crawler/`): seeds `/` plus every `<loc>` path in `sitemap.xml`, then walks the accessibility tree using Playwright's aria snapshot, parsed for nodes with roles `link`, `button`, `menuitem`, `tab`, and `option`. Links with a same-origin `/url` are queued without clicking; external links are ignored; everything else is clicked from a fresh load of the Page. A URL change is a new Page (client-side `pushState` included); a changed tree is a Page State recorded with the interactions that reached it, explored one level further so menu items behind a menu button are found. Trees already seen on a Page are not new states, so closing a dialog or re-selecting the current tab records nothing. Sequences are capped at two interactions.

Limits: depth counts link hops from a seed (seeds are depth 0; a Page at the limit is recorded but not crawled), the page limit counts Pages including seeds, query stripping drops `?…` from the Page identity, numeric collapsing treats `/users/1` and `/users/2` as one Page keeping the first path seen. Defaults chosen here, since the spec named none: depth 3, 50 Pages, stripping on, collapsing on. Both Instances are crawled and the results merged, so a Page the Target Branch adds is found.

Repository Config gains a Discovery section: crawl depth, page limit, the two toggles, and Added and Removed Pages (one path per line), stored with the config; configs saved before this ticket read back with the defaults. Removed Pages also drop their Page States. The Compare page shows a "Discovering the Pages of …" stage and, once running, the discovered Pages and Page States.

Fixed on the way: the Proxy kept `Transfer-Encoding: chunked` while adding `Content-Length` to rewritten HTML, which Node's fetch and Chromium reject; dev servers send chunked HTML, so every real Instance would have failed. Added `playwright` (matching `@playwright/test`) as a runtime dependency for the crawler.

Known limits: hidden nodes are invisible to the crawl until an interaction reveals them, so a menu behind a hover is missed; native `<select>` options fail to click and are skipped; a click that opens a new tab is closed and ignored; interactions are identified by role and name only, so the first of two same-named buttons is the one clicked.
