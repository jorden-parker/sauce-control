import { posix } from "node:path";

/** The parts of a source map (plain or indexed) that name the modules it was built from. */
interface SourceMap {
  sections?: { map: SourceMap }[];
  sourceRoot?: string;
  sources?: (string | null)[];
}

const COMMENT =
    /^[ \t]*\/[/*][#@]\s*sourceMappingURL=(\S+?)\s*(?:\*\/)?[ \t]*$/gmu,
  /** Bundler namespaces that wrap a path without changing where the file lives. */
  NAMESPACES =
    /^\/?(?:\[project\]|_N_E|\(app-pages-browser\)|\(app-client\))\//u;

/** The `sourceMappingURL` of a script or stylesheet body, resolved against the body's URL. */
export const sourceMapUrl = (
  body: string,
  bodyUrl: string,
  header?: string
): string | undefined => {
  const comments = [...body.matchAll(COMMENT)],
    reference = header ?? comments.at(-1)?.[1];
  if (reference === undefined) {
    return;
  }
  try {
    return new URL(reference, bodyUrl).href;
  } catch {
    return;
  }
};

/**
 * Where one source of a map lives, as a path a repository file can be matched against: the
 * `sourceRoot` applied, bundler schemes (`webpack://`, `turbopack://`, `file://`) and namespaces
 * removed, queries dropped, and the leading slash gone. Third-party modules are left out.
 */
const modulePath = (
  source: string,
  sourceRoot: string,
  mapUrl: string
): string | undefined => {
  const joined =
    sourceRoot === "" || /^[a-z][a-z0-9+.-]*:/iu.test(source)
      ? source
      : `${sourceRoot.replace(/\/?$/u, "/")}${source}`;
  let pathname: string;
  try {
    // A bare relative path resolves against the map like a browser would.
    pathname = decodeURIComponent(new URL(joined, mapUrl).pathname);
  } catch {
    return;
  }
  const normalized = posix
    .normalize(pathname.replace(NAMESPACES, "/"))
    .replace(/^(?:\.\.?\/)+/u, "")
    .replace(/^\/+/u, "");
  return normalized === "" ||
    normalized.includes("node_modules/") ||
    normalized.startsWith("webpack/") ||
    normalized.startsWith("(webpack)")
    ? undefined
    : normalized;
};

/** Every module path a source map names, sections flattened. */
export const moduleSources = (map: unknown, mapUrl: string): string[] => {
  const walk = (node: SourceMap): string[] => [
    ...(node.sources ?? []).flatMap((source) =>
      source === null
        ? []
        : (modulePath(source, node.sourceRoot ?? "", mapUrl) ?? [])
    ),
    ...(node.sections ?? []).flatMap((section) => walk(section.map)),
  ];
  return typeof map === "object" && map !== null
    ? [...new Set(walk(map as SourceMap))]
    : [];
};

/**
 * Whether a module path names a changed repository file. Module paths keep whatever directory
 * the bundler prefixed (the container's working directory, say), so the repository path only
 * has to end the module path at a segment boundary.
 */
export const moduleMatchesFile = (
  module: string,
  repositoryPath: string
): boolean =>
  module === repositoryPath || module.endsWith(`/${repositoryPath}`);
