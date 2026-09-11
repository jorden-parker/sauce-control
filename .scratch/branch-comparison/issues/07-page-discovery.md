# 07: Page discovery

**What to build:** After Instances start, the tool discovers the application's Pages from the sitemap and by crawling the accessibility tree, including modals and tabs as Page States. A reviewer can bound the crawl per Repository and add or remove Pages by hand.

**Blocked by:** 05 (Two Instances behind the Proxy)

**Status:** ready-for-agent

- [ ] Seeds from `sitemap.xml` when present
- [ ] Crawls by clicking accessibility-tree nodes with roles `link`, `button`, `menuitem`, `tab`, and `option`, so react-aria apps are covered
- [ ] URL changes become Pages; non-navigating changes become Page States with the interaction sequence to reach them
- [ ] Crawl depth, page limit, query stripping, and numeric-segment collapsing configurable per Repository with the agreed defaults
- [ ] Pages can be added or removed manually and persist with the Repository
- [ ] Comparison Runner seam established: fixture Repository with two branches plus a fake Container Runtime adapter; tests assert the discovered Pages and Page States
