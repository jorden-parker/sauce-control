import type { Browser, Response } from "playwright";
import { moduleSources, sourceMapUrl } from "./source-map";

const NAVIGATION_TIMEOUT_MS = 10_000,
  /** How long the Page gets to finish loading lazy chunks after `load`. */
  IDLE_TIMEOUT_MS = 5000,
  MAPPED_RESOURCES = new Set(["script", "stylesheet"]),
  /** The modules one script or stylesheet response was built from, per its source map. */
  modulesOf = async (response: Response): Promise<string[]> => {
    try {
      const header =
          response.headers()["sourcemap"] ?? response.headers()["x-sourcemap"],
        mapUrl = sourceMapUrl(await response.text(), response.url(), header);
      if (mapUrl === undefined) {
        return [];
      }
      if (mapUrl.startsWith("data:")) {
        const [meta = "", payload = ""] = mapUrl
            .slice("data:".length)
            .split(","),
          json = meta.endsWith(";base64")
            ? Buffer.from(payload, "base64").toString()
            : decodeURIComponent(payload);
        return moduleSources(JSON.parse(json), response.url());
      }
      const map = await response.frame().page().request.get(mapUrl);
      return map.ok() ? moduleSources(await map.json(), mapUrl) : [];
    } catch {
      // A body that is gone, an unreachable map, or one that is not JSON: no modules known.
      return [];
    }
  };

/** What loading one URL brought in: the module paths every script and stylesheet was built from, per their source maps. */
export interface LoadedModules {
  /** Whether any resource carried a source map at all. */
  mapped: boolean;
  modules: string[];
}

/** Loads the URL fresh and records the modules its scripts and stylesheets were built from. */
export const loadedModules = async (
  browser: Browser,
  url: string
): Promise<LoadedModules> => {
  const page = await browser.newPage(),
    pending: Promise<string[]>[] = [];
  page.on("dialog", (dialog) => void dialog.dismiss());
  page.on("response", (response) => {
    if (MAPPED_RESOURCES.has(response.request().resourceType())) {
      pending.push(modulesOf(response));
    }
  });
  try {
    await page.goto(url, {
      timeout: NAVIGATION_TIMEOUT_MS,
      waitUntil: "load",
    });
    await page
      .waitForLoadState("networkidle", { timeout: IDLE_TIMEOUT_MS })
      .catch(() => {});
    const found = await Promise.all(pending);
    return {
      mapped: found.some((modules) => modules.length > 0),
      modules: [...new Set(found.flat())],
    };
  } catch {
    // An unreachable Page loads nothing.
    return { mapped: false, modules: [] };
  } finally {
    await page.close();
  }
};
