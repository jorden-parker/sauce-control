import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, relative } from "node:path";
import type { RuntimeAdapter } from "@/container-runtime/runtime-adapter";
import type { InstanceDependencies } from "@/instance/run-instance";
import type { CommandRunner } from "@/shell/command-runner";

export interface FixtureOptions {
  /** Whether the "build" serves source maps; off stands in for a production build without them. */
  sourceMaps?: boolean;
}

/**
 * The fixture Repository: a tiny static app with three branches. `main` has a sitemap, links,
 * tabs, a dialog, a menu, and scripts built from `src/` with source maps; `feature/login`
 * changes `about` and adds `/careers`; `feature/css-only` changes only the stylesheet.
 * Feature branches are directories holding only the files they change or add on top of `main`.
 */
const FIXTURE_ROOT = join(import.meta.dirname, "static-app"),
  BASE_DIRECTORY = "main",
  SERVED_TYPES: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".map": "application/json",
    ".xml": "application/xml",
  },
  SOURCE_MAP_COMMENT = /^\/[/*]# sourceMappingURL=.*$/gmu,
  slug = (text: string): string =>
    text
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, "-")
      .replaceAll(/^-|-$/gu, ""),
  /** Every file below the root, keyed by its path relative to the root. */
  filesUnder = (
    root: string,
    directory = root,
    files = new Map<string, Buffer>()
  ): Map<string, Buffer> => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        filesUnder(root, path, files);
      } else {
        files.set(relative(root, path), readFileSync(path));
      }
    }
    return files;
  },
  /** Every file of a branch: `main` plus the branch's own directory layered on top. */
  branchFiles = (branch: string): Map<string, Buffer> => {
    const directory = slug(branch);
    return directory === BASE_DIRECTORY
      ? filesUnder(join(FIXTURE_ROOT, BASE_DIRECTORY))
      : new Map([
          ...filesUnder(join(FIXTURE_ROOT, BASE_DIRECTORY)),
          ...filesUnder(join(FIXTURE_ROOT, directory)),
        ]);
  },
  sameContent = (
    left: Buffer | undefined,
    right: Buffer | undefined
  ): boolean => left !== undefined && right !== undefined && left.equals(right),
  /** Which branch each clone holds, so a diff run inside a clone knows its HEAD. */
  clones = new Map<string, string>(),
  /** "Clones" a branch by writing its files to the destination; "diffs" two by comparing their files. */
  fixtureGit: CommandRunner = {
    run: (_command, args, options) => {
      if (args[0] === "clone") {
        const destination = args.at(-1)!,
          branch = args[args.indexOf("--branch") + 1] ?? "";
        clones.set(destination, branch);
        for (const [path, content] of branchFiles(branch)) {
          mkdirSync(dirname(join(destination, path)), { recursive: true });
          writeFileSync(join(destination, path), content);
        }
        return Promise.resolve({ stdout: "" });
      }
      if (args[0] === "diff") {
        const [, baseBranch = ""] =
            /^origin\/(.+)\.\.\.HEAD$/u.exec(args.at(-1) ?? "") ?? [],
          base = branchFiles(baseBranch),
          target = branchFiles(clones.get(options?.cwd ?? "") ?? ""),
          changed = [...new Set([...base.keys(), ...target.keys()])]
            .filter((path) => !sameContent(base.get(path), target.get(path)))
            .toSorted();
        return Promise.resolve({ stdout: `${changed.join("\n")}\n` });
      }
      return Promise.resolve({ stdout: "" });
    },
  },
  serveDirectory = (
    files: Map<string, Buffer>,
    { sourceMaps = true }: FixtureOptions
  ): Promise<Server> =>
    new Promise((resolve) => {
      const server = createServer((request, response) => {
        const pathname = (request.url ?? "/").split("?")[0] ?? "/",
          path = [pathname, `${pathname}.html`, join(pathname, "index.html")]
            .map((candidate) => candidate.replace(/^\/+/u, ""))
            .find((candidate) => files.has(candidate)),
          extension = path === undefined ? "" : `.${path.split(".").at(-1)}`,
          type = SERVED_TYPES[extension];
        if (
          path === undefined ||
          type === undefined ||
          (!sourceMaps && extension === ".map")
        ) {
          response.writeHead(404, { "content-type": "text/plain" });
          response.end("not found");
          return;
        }
        const content = files.get(path)!;
        response.writeHead(200, { "content-type": type });
        response.end(
          sourceMaps || extension !== ".js"
            ? content
            : content.toString().replaceAll(SOURCE_MAP_COMMENT, "")
        );
      });
      server.listen(0, "127.0.0.1", () => resolve(server));
    }),
  /** A Container Runtime that "runs" an image by serving its build context over HTTP. */
  fixtureRuntime = (options: FixtureOptions): RuntimeAdapter => {
    const contexts = new Map<string, Map<string, Buffer>>(),
      servers = new Map<string, Server>();
    let nextId = 0;
    return {
      buildImage: (_name, request) => {
        contexts.set(request.tag, filesUnder(join(request.context, "source")));
        return Promise.resolve();
      },
      detect: (name) =>
        Promise.resolve({
          installed: true,
          name,
          running: true,
          version: "29.7.2",
        }),
      inspectContainers: () => Promise.resolve([]),
      isListening: () => Promise.resolve(true),
      listContainers: () => Promise.resolve([]),
      removeContainers: async (_name, ids) => {
        await Promise.all(
          ids.map(
            (id) =>
              new Promise<void>((done) => {
                const server = servers.get(id);
                servers.delete(id);
                if (server === undefined) {
                  done();
                } else {
                  server.close(() => done());
                }
              })
          )
        );
      },
      removeImages: () => Promise.resolve(),
      runContainer: async (_name, request) => {
        const context = contexts.get(request.image);
        if (context === undefined) {
          throw new Error(`No image ${request.image}`);
        }
        const server = await serveDirectory(context, options);
        nextId += 1;
        const containerId = `fixture-${nextId}`;
        servers.set(containerId, server);
        return {
          containerId,
          hostPort: (server.address() as AddressInfo).port,
        };
      },
      start: () => Promise.resolve(),
      startContainers: () => Promise.resolve(),
      stopContainers: () => Promise.resolve(),
    };
  };

/** Runner dependencies that serve the fixture Repository directly, no containers involved. */
export const fixtureDependencies = (
  options: FixtureOptions = {}
): InstanceDependencies => ({
  git: fixtureGit,
  runtime: fixtureRuntime(options),
});
