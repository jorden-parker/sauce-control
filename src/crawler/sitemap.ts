/** Paths listed in a sitemap; the host is ignored because the Instance serves them all. */
export const sitemapPaths = (xml: string): string[] =>
  [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gu)].flatMap((match) => {
    try {
      return [new URL(match[1]!).pathname];
    } catch {
      return [];
    }
  });

const SITEMAP_TIMEOUT_MS = 10_000;

/** Fetches and parses `sitemap.xml` under `origin`; empty when absent or when the Instance never answers. */
export const fetchSitemapPaths = async (
  origin: string,
  signal?: AbortSignal
): Promise<string[]> => {
  try {
    const timeout = AbortSignal.timeout(SITEMAP_TIMEOUT_MS),
      response = await fetch(new URL("/sitemap.xml", origin), {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    return response.ok ? sitemapPaths(await response.text()) : [];
  } catch {
    signal?.throwIfAborted();
    return [];
  }
};
