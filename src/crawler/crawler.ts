/* oxlint-disable no-await-in-loop -- one browser page is driven step by step; clicks cannot run in parallel */
import { type Browser, type Page as BrowserPage, chromium } from "playwright";
import { type Candidate, parseCandidates } from "./aria-snapshot";
import type { CrawlLimits } from "./crawl-limits";
import { pageKey, pagePath } from "./normalize-path";
import type { Interaction, Page, PageState } from "./page";
import { fetchSitemapPaths } from "./sitemap";

export interface CrawlRequest {
  signal?: AbortSignal;
  onProgress?: (visited: number) => void;
  limits: CrawlLimits;
  /** The Instance's URL through the Proxy. */
  origin: string;
}

export interface CrawlResult {
  pageStates: PageState[];
  pages: Page[];
}

const NAVIGATION_TIMEOUT_MS = 10_000,
  CLICK_TIMEOUT_MS = 2000,
  /** How long a click gets to change the page before it is judged. */
  SETTLE_MS = 200,
  /** Interaction sequences longer than this (a menu, then an item) are not explored. */
  MAX_INTERACTIONS = 2;

/** Pages found so far, keyed under the crawl limits, plus the queue of ones still to visit. */
class Frontier {
  readonly pages: Page[] = [];
  readonly pageStates: PageState[] = [];
  readonly queue: { depth: number; path: string }[] = [];
  private readonly keys = new Set<string>();

  constructor(private readonly limits: CrawlLimits) {}

  /** Records a path as a Page unless it is known or the page limit is reached; queues it for a visit. */
  add(path: string, depth: number): void {
    const key = pageKey(path, this.limits);
    if (this.keys.has(key) || this.pages.length >= this.limits.pageLimit) {
      return;
    }
    this.keys.add(key);
    this.pages.push({ path: pagePath(path, this.limits) });
    this.queue.push({ depth, path: pagePath(path, this.limits) });
  }
}

const sameOrigin = (href: string, origin: string): string | undefined => {
    try {
      const url = new URL(href, origin);
      return url.origin === new URL(origin).origin
        ? `${url.pathname}${url.search}`
        : undefined;
    } catch {
      return;
    }
  },
  currentPath = (page: BrowserPage, origin: string): string | undefined =>
    sameOrigin(page.url(), origin),
  sameNode = (left: Interaction, right: Interaction): boolean =>
    left.role === right.role && left.name === right.name,
  snapshot = (page: BrowserPage): Promise<string> =>
    page.locator("body").ariaSnapshot(),
  /** Clicks the first node matching the interaction; false when there is none or it will not click. */
  perform = async (
    page: BrowserPage,
    { name, role }: Interaction
  ): Promise<boolean> => {
    try {
      await page
        .getByRole(role as "button", { exact: true, name })
        .first()
        .click({ timeout: CLICK_TIMEOUT_MS });
      await page.waitForTimeout(SETTLE_MS);
      await page.waitForLoadState("load", { timeout: NAVIGATION_TIMEOUT_MS });
      return true;
    } catch {
      return false;
    }
  };

/** Everything the crawler knows while exploring one Page. */
interface Visit {
  signal?: AbortSignal;
  depth: number;
  frontier: Frontier;
  limits: CrawlLimits;
  origin: string;
  page: BrowserPage;
  path: string;
  /** Accessibility trees already seen on this Page, so a closed dialog is not a new state. */
  seen: Set<string>;
}

/** Loads the Page fresh and replays the sequence; false when a step no longer clicks. */
const open = async (
    visit: Visit,
    sequence: Interaction[]
  ): Promise<boolean> => {
    visit.signal?.throwIfAborted();
    await visit.page.goto(new URL(visit.path, visit.origin).href, {
      timeout: NAVIGATION_TIMEOUT_MS,
      waitUntil: "load",
    });
    for (const interaction of sequence) {
      if (!(await perform(visit.page, interaction))) {
        return false;
      }
    }
    return true;
  },
  /** What one click did: went to another Page, changed this one, or nothing observable. */
  outcome = async (
    visit: Visit,
    interaction: Interaction
  ): Promise<
    | { kind: "nothing" }
    | { kind: "page"; path: string }
    | { kind: "state"; tree: string }
  > => {
    if (!(await perform(visit.page, interaction))) {
      return { kind: "nothing" };
    }
    const landed = currentPath(visit.page, visit.origin);
    if (landed === undefined) {
      return { kind: "nothing" };
    }
    if (pageKey(landed, visit.limits) !== pageKey(visit.path, visit.limits)) {
      return { kind: "page", path: landed };
    }
    const tree = await snapshot(visit.page);
    return visit.seen.has(tree) ? { kind: "nothing" } : { kind: "state", tree };
  },
  /**
   * Reaches the state behind `sequence` fresh, then tries each clickable node that was not
   * there before. A URL change is a Page; a changed tree is a Page State, explored one level further.
   */
  explore = async (
    visit: Visit,
    sequence: Interaction[],
    before: Candidate[]
  ): Promise<void> => {
    if (!(await open(visit, sequence))) {
      return;
    }
    const candidates = parseCandidates(await snapshot(visit.page)).filter(
      (candidate, index, all) =>
        all.findIndex((other) => sameNode(other, candidate)) === index &&
        !before.some((other) => sameNode(other, candidate))
    );
    for (const { url, ...interaction } of candidates) {
      visit.signal?.throwIfAborted();
      if (url !== undefined) {
        const target = sameOrigin(url, visit.origin);
        if (target !== undefined) {
          visit.frontier.add(target, visit.depth + 1);
        }
        continue;
      }
      if (!(await open(visit, sequence))) {
        continue;
      }
      const result = await outcome(visit, interaction);
      if (result.kind === "page") {
        visit.frontier.add(result.path, visit.depth + 1);
      } else if (result.kind === "state") {
        visit.seen.add(result.tree);
        const reached = [...sequence, interaction];
        visit.frontier.pageStates.push({
          interactions: reached,
          path: visit.path,
        });
        if (reached.length < MAX_INTERACTIONS) {
          await explore(visit, reached, [...before, ...candidates]);
        }
      }
    }
  },
  visitPage = async (
    browser: Browser,
    { limits, origin, signal }: CrawlRequest,
    frontier: Frontier,
    { depth, path }: { depth: number; path: string }
  ): Promise<void> => {
    const page = await browser.newPage();
    page.context().on("page", (popup) => void popup.close());
    page.on("dialog", (dialog) => void dialog.dismiss());
    try {
      await page.goto(new URL(path, origin).href, {
        timeout: NAVIGATION_TIMEOUT_MS,
        waitUntil: "load",
      });
      const seen = new Set([await snapshot(page)]);
      await explore(
        { depth, frontier, limits, origin, page, path, seen, signal },
        [],
        []
      );
    } catch {
      // An unreachable or broken Page is still a Page; it just leads nowhere.
    } finally {
      await page.close();
    }
  };

/** Discovers Pages and Page States of one Instance: sitemap first, then the accessibility tree. */
export const crawl = async ({
  limits,
  origin,
  signal,
  onProgress,
}: CrawlRequest): Promise<CrawlResult> => {
  const frontier = new Frontier(limits);
  for (const path of ["/", ...(await fetchSitemapPaths(origin, signal))]) {
    frontier.add(path, 0);
  }
  signal?.throwIfAborted();
  const browser = await chromium.launch(),
    abort = () => {
      void browser.close().catch(() => {});
    };
  signal?.addEventListener("abort", abort, { once: true });
  let visited = 0;
  try {
    signal?.throwIfAborted();
    for (;;) {
      signal?.throwIfAborted();
      const next = frontier.queue.shift();
      if (next === undefined) {
        break;
      }
      if (next.depth < limits.maxDepth) {
        await visitPage(browser, { limits, origin, signal }, frontier, next);
        signal?.throwIfAborted();
        onProgress?.(++visited);
      }
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await browser.close();
  }
  return { pageStates: frontier.pageStates, pages: frontier.pages };
};
