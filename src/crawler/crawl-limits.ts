/** How far discovery may go for one Repository, so large apps stay bounded. */
export interface CrawlLimits {
  /** Treat `/users/1` and `/users/2` as one Page. */
  collapseNumericSegments: boolean;
  /** Link hops from a seed Page beyond which nothing is crawled. */
  maxDepth: number;
  /** Stop discovering once this many Pages are known. */
  pageLimit: number;
  /** Treat `/about?tab=team` as `/about`. */
  stripQuery: boolean;
}

export const DEFAULT_CRAWL_LIMITS: CrawlLimits = {
  collapseNumericSegments: true,
  maxDepth: 3,
  pageLimit: 50,
  stripQuery: true,
};
