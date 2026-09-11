import { type CrawlResult, crawl } from "@/crawler/crawler";
import { pageKey } from "@/crawler/normalize-path";
import type { Page, PageState } from "@/crawler/page";
import { INSTANCE_ROLES } from "@/proxy/proxy";
import type { RepositoryConfig } from "@/settings/settings-store";
import type { RunningComparison } from "./run-comparison";

/** What discovery found across both Instances, after the reviewer's manual additions and removals. */
export interface Discovery {
  pageStates: PageState[];
  pages: Page[];
}

const stateKey = (state: PageState): string => JSON.stringify(state),
  uniqueBy = <T>(items: T[], key: (item: T) => string): T[] => {
    const seen = new Set<string>();
    return items.filter((item) => {
      const itemKey = key(item);
      if (seen.has(itemKey)) {
        return false;
      }
      seen.add(itemKey);
      return true;
    });
  };

/**
 * Crawls both Instances through the Proxy under the Repository's crawl limits and merges what
 * they found: a Page the Target Branch adds is as much part of the Comparison as one it removes.
 */
export const discoverPages = async (
  { proxy }: RunningComparison,
  { crawl: limits, pages: manual }: Pick<RepositoryConfig, "crawl" | "pages">
): Promise<Discovery> => {
  const results: CrawlResult[] = await Promise.all(
      INSTANCE_ROLES.map((role) =>
        crawl({ limits, origin: proxy.urlFor(role) })
      )
    ),
    removed = new Set(manual.removed.map((path) => pageKey(path, limits))),
    pages = uniqueBy(
      [
        ...results.flatMap((result) => result.pages),
        ...manual.added.map((path) => ({ path })),
      ],
      (page) => pageKey(page.path, limits)
    ).filter((page) => !removed.has(pageKey(page.path, limits)));
  return {
    pageStates: uniqueBy(
      results.flatMap((result) => result.pageStates),
      stateKey
    ).filter((state) => !removed.has(pageKey(state.path, limits))),
    pages,
  };
};
