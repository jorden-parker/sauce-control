import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { INSTANCE_ROLES, type InstanceRole, startProxy } from "@/proxy/proxy";
import { syncAppPage } from "./fixtures/sync-app";
import type { RunningComparison } from "./run-comparison";

const hostPort = (server: Server): number =>
    (server.address() as AddressInfo).port,
  serveFixture = (role: InstanceRole): Promise<Server> =>
    new Promise((resolve) => {
      const server = createServer((request, response) => {
        const html = syncAppPage(role, request.url ?? "/");
        if (html === undefined) {
          response.writeHead(404, { "content-type": "text/plain" });
          response.end("not found");
          return;
        }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(html);
      });
      server.listen(0, "127.0.0.1", () => resolve(server));
    });

/**
 * Stands in for the runner under `SAUCE_CONTROL_COMPARISON=stub`: no containers, but the
 * fixture app for each role behind the real Proxy, so injection and sync work as they would.
 */
export const runStubComparison = async (): Promise<RunningComparison> => {
  const servers = await Promise.all(INSTANCE_ROLES.map(serveFixture)),
    [base, target] = servers as [Server, Server],
    proxy = await startProxy({
      instances: {
        base: { hostPort: hostPort(base) },
        target: { hostPort: hostPort(target) },
      },
    }),
    instance = (branch: string, server: Server) => ({
      branch,
      clonePath: "",
      containerId: "",
      hostPort: hostPort(server),
    });
  return {
    base: instance("base", base),
    proxy,
    stop: async () => {
      await proxy.close();
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((done) => {
              server.close(() => done());
            })
        )
      );
    },
    target: instance("target", target),
  };
};
