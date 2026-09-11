import { cpSync, readFileSync, statSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { RuntimeAdapter } from "@/container-runtime/runtime-adapter";
import type { InstanceDependencies } from "@/instance/run-instance";
import type { CommandRunner } from "@/shell/command-runner";

/**
 * The fixture Repository: a tiny static app with two branches. `main` has a sitemap, links,
 * tabs, a dialog, and a menu; `feature/login` changes `about.html` and adds `/careers`.
 */
const FIXTURE_ROOT = join(import.meta.dirname, "static-app"),
  slug = (text: string): string =>
    text
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, "-")
      .replaceAll(/^-|-$/gu, ""),
  /** "Clones" a branch by copying its fixture directory to the destination. */
  fixtureGit: CommandRunner = {
    run: (_command, args) => {
      const branch = args[args.indexOf("--branch") + 1] ?? "",
        destination = args.at(-1)!;
      cpSync(join(FIXTURE_ROOT, slug(branch)), destination, {
        recursive: true,
      });
      return Promise.resolve({ stdout: "" });
    },
  },
  fileFor = (root: string, path: string): string | undefined => {
    const pathname = path.split("?")[0] ?? "/",
      candidates = [
        join(root, pathname),
        join(root, `${pathname}.html`),
        join(root, pathname, "index.html"),
      ];
    return candidates.find((candidate) => {
      try {
        return statSync(candidate).isFile();
      } catch {
        return false;
      }
    });
  },
  contentType = (file: string): string =>
    file.endsWith(".xml")
      ? "application/xml"
      : file.endsWith(".html")
        ? "text/html; charset=utf-8"
        : "application/octet-stream",
  serveDirectory = (root: string): Promise<Server> =>
    new Promise((resolve) => {
      const server = createServer((request, response) => {
        const file = fileFor(root, request.url ?? "/");
        if (
          file === undefined ||
          (!file.endsWith(".html") && !file.endsWith(".xml"))
        ) {
          response.writeHead(404, { "content-type": "text/plain" });
          response.end("not found");
          return;
        }
        response.writeHead(200, { "content-type": contentType(file) });
        response.end(readFileSync(file));
      });
      server.listen(0, "127.0.0.1", () => resolve(server));
    }),
  /** A Container Runtime that "runs" an image by serving its build context over HTTP. */
  fixtureRuntime = (): RuntimeAdapter => {
    const contexts = new Map<string, string>(),
      servers = new Map<string, Server>();
    let nextId = 0;
    return {
      buildImage: (_name, request) => {
        contexts.set(request.tag, request.context);
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
        const server = await serveDirectory(context);
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
export const fixtureDependencies = (): InstanceDependencies => ({
  git: fixtureGit,
  runtime: fixtureRuntime(),
});
