import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { EndpointRecordings } from "@/endpoints/endpoint-recordings";
import { INSTANCE_ROLES, type InstanceRole, startProxy } from "@/proxy/proxy";
import { syncAppPage } from "./fixtures/sync-app";
import type { RunningComparison } from "./run-comparison";
import { createScenarioCollection } from "@/scenarios/scenarios";

const hostPort = (server: Server): number =>
    (server.address() as AddressInfo).port,
  listen = (server: Server): Promise<Server> =>
    new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve(server));
    }),
  serveFixture = (role: InstanceRole, apiOrigin: string): Promise<Server> =>
    listen(
      createServer((request, response) => {
        const html = syncAppPage(role, request.url ?? "/", apiOrigin);
        if (html === undefined) {
          response.writeHead(404, { "content-type": "text/plain" });
          response.end("not found");
          return;
        }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(html);
      })
    ),
  /** The fixture app's external API: one user per numeric id. */
  serveApi = (): Promise<Server> =>
    listen(
      createServer((request, response) => {
        const id = Number((request.url ?? "").split("/").at(-1));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id, name: "Ada" }));
      })
    );

/**
 * Stands in for the runner under `SAUCE_CONTROL_COMPARISON=stub`: no containers, but the
 * fixture app for each role behind the real Proxy, so injection, sync, and Endpoint recording
 * work as they would.
 */
export const runStubComparison = async ({
  recordings,
  repository,
}: {
  recordings: EndpointRecordings;
  repository: string;
}): Promise<RunningComparison> => {
  const collection = createScenarioCollection(),
    api = await serveApi(),
    apiOrigin = `http://127.0.0.1:${hostPort(api)}`,
    servers = await Promise.all(
      INSTANCE_ROLES.map((role) => serveFixture(role, apiOrigin))
    ),
    [base, target] = servers as [Server, Server],
    proxy = await startProxy({
      instances: {
        base: { hostPort: hostPort(base) },
        target: { hostPort: hostPort(target) },
      },
      // The fixture API is on loopback, which the Proxy otherwise refuses to relay to.
      localEndpointOrigins: [apiOrigin],
      recordEndpoint: (call) => {
        collection.record(call);
        recordings.record(repository, call);
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
    scenarios: collection.scenarios,
    stop: async () => {
      await proxy.close();
      await Promise.all(
        [...servers, api].map(
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
