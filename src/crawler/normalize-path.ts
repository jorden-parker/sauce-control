import type { CrawlLimits } from "./crawl-limits";

/** The identity of a Page under the crawl limits: two paths with one key are one Page. */
export const pageKey = (
  path: string,
  { collapseNumericSegments, stripQuery }: CrawlLimits
): string => {
  const [pathname = "/", query] = path.split("#")[0]!.split("?"),
    collapsed = collapseNumericSegments
      ? pathname.replaceAll(/\/\d+(?=\/|$)/gu, "/{n}")
      : pathname;
  return stripQuery || query === undefined || query === ""
    ? collapsed
    : `${collapsed}?${query}`;
};

/** The path as stored for a Page: no hash, and no query when stripping. */
export const pagePath = (path: string, { stripQuery }: CrawlLimits): string => {
  const [pathname = "/", query] = path.split("#")[0]!.split("?");
  return stripQuery || query === undefined || query === ""
    ? pathname
    : `${pathname}?${query}`;
};
