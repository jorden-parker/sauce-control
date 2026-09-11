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

export const INSTANCE_HEADER = "x-sauce-control-instance",
  INSTANCE_ROLES = ["base", "target"] as const;

export type InstanceRole = (typeof INSTANCE_ROLES)[number];

export interface ProxyRequest {
  injection?: Injection;
  /** Loopback host port of each running Instance. */
  instances: Record<InstanceRole, { hostPort: number }>;
}

/** The tool's Proxy in front of both Instances. */
export interface Proxy {
  close: () => Promise<void>;
  port: number;
  /** The URL a browser opens to reach one Instance. */
  urlFor: (role: InstanceRole) => string;
}

/** The Instance a request is for, and the path to forward, from its path prefix or header. */
const route = (
    request: IncomingMessage
  ): { path: string; role: InstanceRole } | undefined => {
    const url = request.url ?? "/",
      prefixed = /^\/(base|target)(\/.*)?$/u.exec(url);
    if (prefixed) {
      return { path: prefixed[2] ?? "/", role: prefixed[1] as InstanceRole };
    }
    const header = request.headers[INSTANCE_HEADER];
    if (header === "base" || header === "target") {
      return { path: url, role: header };
    }
    return undefined;
  },
  notFound = (response: ServerResponse): void => {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end(
      `No Instance named. Open /base/ or /target/, or send ${INSTANCE_HEADER}: base|target.`
    );
  },
  cookieHeader = (jar: CookieJar): { cookie?: string } => {
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
          { "set-cookie": setCookies = [], ...headers } =
            upstreamResponse.headers;
        jar.store(setCookies);
        if (!isHtml(upstreamResponse)) {
          response.writeHead(status, headers);
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
  };

/** Listens on a free loopback port and forwards to whichever Instance the request names. */
export const startProxy = ({
  injection = DEFAULT_INJECTION,
  instances,
}: ProxyRequest): Promise<Proxy> =>
  new Promise((resolve) => {
    const jar = createCookieJar(),
      server: Server = createServer((request, response) => {
        const target = route(request);
        if (target === undefined) {
          notFound(response);
          return;
        }
        forward(
          request,
          response,
          instances[target.role].hostPort,
          target.path,
          injection,
          jar
        );
      });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
        port,
        urlFor: (role) => `http://127.0.0.1:${port}/${role}/`,
      });
    });
  });
