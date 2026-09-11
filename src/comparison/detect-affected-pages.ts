import { chromium } from "playwright";
import { loadedModules } from "@/crawler/loaded-modules";
import type { Page } from "@/crawler/page";
import { moduleMatchesFile } from "@/crawler/source-map";
import { changedFiles } from "@/instance/changed-files";
import { INSTANCE_ROLES } from "@/proxy/proxy";
import type { CommandRunner } from "@/shell/command-runner";
import type { Discovery } from "./discover-pages";
import type { RunningComparison } from "./run-comparison";

/** Why detection is off and every Page is listed instead, per ADR 0002. */
export type DetectionFallback = "missing-source-maps" | "non-module-changes";

/** Which Pages the Target Branch's changes can reach, or every Page when that cannot be told. */
export interface AffectedPages {
  /** Repository-relative paths changed between the branches. */
  changedFiles: string[];
  /** Set when detection is off; `pages` is then every discovered Page. */
  fallback?: DetectionFallback;
  pages: Page[];
  /** Changed files no Page loads as a module, so the change may reach Pages not listed. */
  unattributed: string[];
}

/** Pages loaded at once, in both Instances each, so a large app does not open a hundred tabs. */
const PAGE_CONCURRENCY = 4,
  loadsFile = (modules: string[], file: string): boolean =>
    modules.some((module) => moduleMatchesFile(module, file)),
  /** Loads the Page in both Instances and unions the modules, so a module only one branch loads still counts. */
  modulesOfPage = async (
    browser: Parameters<typeof loadedModules>[0],
    { proxy }: RunningComparison,
    page: Page
  ) => {
    const loads = await Promise.all(
      INSTANCE_ROLES.map((role) =>
        loadedModules(browser, new URL(page.path, proxy.urlFor(role)).href)
      )
    );
    return {
      mapped: loads.some((load) => load.mapped),
      modules: loads.flatMap((load) => load.modules),
      page,
    };
  };

/**
 * Records the modules every discovered Page loads, via source maps, and intersects them with
 * the files changed between the branches. Without source maps, or when no changed file is a
 * module any Page loads (a stylesheet, config), every Page is listed and the fallback says why.
 */
export const detectAffectedPages = async (
  git: CommandRunner,
  comparison: RunningComparison,
  discovery: Discovery
): Promise<AffectedPages> => {
  const changed = await changedFiles(git, {
      baseBranch: comparison.base.branch,
      clonePath: comparison.target.clonePath,
    }),
    browser = await chromium.launch(),
    loaded = await (async () => {
      try {
        const queue = [...discovery.pages],
          results: Awaited<ReturnType<typeof modulesOfPage>>[] = [],
          worker = async (): Promise<void> => {
            for (;;) {
              const page = queue.shift();
              if (page === undefined) {
                return;
              }
              // oxlint-disable-next-line no-await-in-loop -- each worker takes one Page at a time
              results.push(await modulesOfPage(browser, comparison, page));
            }
          };
        await Promise.all(
          Array.from({ length: PAGE_CONCURRENCY }, () => worker())
        );
        return results;
      } finally {
        await browser.close();
      }
    })(),
    attributed = changed.filter((file) =>
      loaded.some(({ modules }) => loadsFile(modules, file))
    ),
    unattributed = changed.filter((file) => !attributed.includes(file)),
    fallback: DetectionFallback | undefined = loaded.every(
      ({ mapped }) => !mapped
    )
      ? "missing-source-maps"
      : attributed.length === 0
        ? "non-module-changes"
        : undefined;
  return {
    changedFiles: changed,
    ...(fallback === undefined ? {} : { fallback }),
    pages:
      fallback === undefined
        ? loaded
            .filter(({ modules }) =>
              attributed.some((file) => loadsFile(modules, file))
            )
            .map(({ page }) => page)
        : discovery.pages,
    unattributed,
  };
};
