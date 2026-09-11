/** Paths listed in a sitemap; the host is ignored because the Instance serves them all. */
export const sitemapPaths = (xml: string): string[] =>
  [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gu)].flatMap((match) => {
    try {
      return [new URL(match[1]!).pathname];
    } catch {
      return [];
    }
  });

/** Fetches and parses `sitemap.xml` under `origin`; empty when absent. */
export const fetchSitemapPaths = async (origin: string): Promise<string[]> => {
  try {
    const response = await fetch(new URL("/sitemap.xml", origin));
    return response.ok ? sitemapPaths(await response.text()) : [];
  } catch {
    return [];
  }
};
