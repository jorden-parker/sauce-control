import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
  request as httpRequest,
} from "node:http";
import type { AddressInfo } from "node:net";
import { type CookieJar, createCookieJar } from "./cookie-jar";
import { type Injection, injectIntoHtml } from "./injection";

const DEFAULT_INJECTION: Injection = {
  fixedNowMs: Date.UTC(2024, 0, 15, 12, 0, 0),
  randomSeed: 0x5a_ce_00_01,
};

export const INSTANCE_ROLES = ["base", "target"] as const;

export type InstanceRole = (typeof INSTANCE_ROLES)[number];

export interface ProxyRequest {
  injection?: Injection;
  /** Loopback host port of each running Instance; read per request, so updating it reroutes. */
  instances: Record<InstanceRole, { hostPort: number }>;
}

/**
 * The tool's Proxy in front of both Instances. Each Instance gets its own loopback port so
 * absolute links and asset paths inside it keep working when it is embedded.
 */
export interface Proxy {
  close: () => Promise<void>;
  ports: Record<InstanceRole, number>;
  /** The URL a browser opens to reach one Instance. */
  urlFor: (role: InstanceRole) => string;
}

const cookieHeader = (jar: CookieJar): { cookie?: string } => {
    const cookie = jar.header();
    return cookie === undefined ? {} : { cookie };
  },
  isHtml = (upstreamResponse: IncomingMessage): boolean =>
    (upstreamResponse.headers["content-type"] ?? "").startsWith("text/html"),
  collect = (stream: IncomingMessage): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    }),
  forward = (
    request: IncomingMessage,
    response: ServerResponse,
    hostPort: number,
    path: string,
    injection: Injection,
    jar: CookieJar
  ): void => {
    const upstream = httpRequest(
      {
        headers: {
          ...request.headers,
          // Plain bodies so HTML can be rewritten.
          "accept-encoding": "identity",
          host: "localhost:3000",
          // The jar, not the browser, owns cookies for both Instances.
          ...cookieHeader(jar),
        },
        host: "127.0.0.1",
        method: request.method,
        path,
        port: hostPort,
      },
      (upstreamResponse) => {
        const status = upstreamResponse.statusCode ?? 502,
          {
            "set-cookie": setCookies = [],
            "transfer-encoding": chunked,
            ...headers
          } = upstreamResponse.headers;
        jar.store(setCookies);
        if (!isHtml(upstreamResponse)) {
          // Piped through as-is, so the upstream framing still applies.
          response.writeHead(status, {
            ...headers,
            ...(chunked === undefined ? {} : { "transfer-encoding": chunked }),
          });
          upstreamResponse.pipe(response);
          return;
        }
        collect(upstreamResponse)
          .then((body) => {
            const html = injectIntoHtml(body.toString("utf8"), injection);
            response.writeHead(status, {
              ...headers,
              "content-length": String(Buffer.byteLength(html)),
            });
            response.end(html);
          })
          .catch((error: Error) => {
            response.writeHead(502, { "content-type": "text/plain" });
            response.end(`Instance response failed: ${error.message}`);
          });
      }
    );
    upstream.on("error", (error) => {
      response.writeHead(502, { "content-type": "text/plain" });
      response.end(`Instance unreachable: ${error.message}`);
    });
    request.pipe(upstream);
  },
  /** Listens on one free loopback port per Instance and forwards each to its own container. */
  listen = (
    handler: (request: IncomingMessage, response: ServerResponse) => void
  ) =>
    new Promise<Server>((resolve) => {
      const server = createServer(handler);
      server.listen(0, "127.0.0.1", () => resolve(server));
    });

export const startProxy = async ({
  injection = DEFAULT_INJECTION,
  instances,
}: ProxyRequest): Promise<Proxy> => {
  const jar = createCookieJar(),
    servers = await Promise.all(
      INSTANCE_ROLES.map(async (role) => ({
        role,
        server: await listen((request, response) =>
          forward(
            request,
            response,
            instances[role].hostPort,
            request.url ?? "/",
            injection,
            jar
          )
        ),
      }))
    ),
    ports = Object.fromEntries(
      servers.map(({ role, server }) => [
        role,
        (server.address() as AddressInfo).port,
      ])
    ) as Record<InstanceRole, number>;
  return {
    close: async () => {
      await Promise.all(
        servers.map(
          ({ server }) =>
            new Promise<void>((done, fail) => {
              server.close((error) => (error ? fail(error) : done()));
            })
        )
      );
    },
    ports,
    urlFor: (role) => `http://127.0.0.1:${ports[role]}/`,
  };
};
