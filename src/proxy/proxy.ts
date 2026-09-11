import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
  request as httpRequest,
} from "node:http";
import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import {
  type AddressInfo,
  BlockList,
  type LookupFunction,
  isIP,
} from "node:net";
import type { EndpointCall } from "@/endpoints/endpoint-recordings";
import { type CookieJar, createCookieJar } from "./cookie-jar";
import { ENDPOINT_ROUTE, type Injection, injectIntoHtml } from "./injection";
import { INSTANCE_ROLES, type InstanceRole } from "./instance-role";

const DEFAULT_INJECTION: Injection = {
  fixedNowMs: Date.UTC(2024, 0, 15, 12, 0, 0),
  randomSeed: 0x5a_ce_00_01,
};

export { INSTANCE_ROLES, type InstanceRole };

export interface ProxyRequest {
  injection?: Injection;
  /** Loopback host port of each running Instance; read per request, so updating it reroutes. */
  instances: Record<InstanceRole, { hostPort: number }>;
  /**
   * Origins on this machine or a private network that pages may still call, such as a fixture
   * API. Every other local target is refused, so code under review cannot read local services.
   */
  localEndpointOrigins?: string[];
  /** Receives every Endpoint call either Instance's pages make, once it has been answered. */
  recordEndpoint?: (call: EndpointCall) => void;
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

/** Addresses a page may not reach through the Proxy: this machine, private networks, link-local, and every IPv4-mapped address. */
const LOCAL_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  LOCAL_ADDRESSES.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["fc00::", 7],
  ["fe80::", 10],
] as const) {
  LOCAL_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

/** An Endpoint target the Proxy will not relay to because it is local. */
class LocalTargetError extends Error {}

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
  HOP_BY_HOP = [
    "connection",
    "keep-alive",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ],
  /** The Proxy origin's cookies and the browser's framing never reach an Endpoint. */
  NOT_FORWARDED = new Set([
    ...HOP_BY_HOP,
    "accept-encoding",
    "content-length",
    "cookie",
    "host",
  ]),
  /** The body is re-sent in one piece, so framing is recomputed; cookies from an Endpoint stay out of the Proxy's origin. */
  NOT_RETURNED = new Set([...HOP_BY_HOP, "content-length", "set-cookie"]),
  plainText = { "content-type": "text/plain" },
  isEndpointRoute = (path: string): boolean =>
    path === ENDPOINT_ROUTE || path.startsWith(`${ENDPOINT_ROUTE}?`),
  /** The absolute http(s) URL an Endpoint route names, or undefined when it names none. */
  endpointTarget = (path: string): URL | undefined => {
    const target = new URL(path, "http://proxy.invalid").searchParams.get(
      "url"
    );
    try {
      const url = new URL(target ?? "");
      return url.protocol === "http:" || url.protocol === "https:"
        ? url
        : undefined;
    } catch {
      return;
    }
  },
  forwardedHeaders = (request: IncomingMessage): Record<string, string> => ({
    ...Object.fromEntries(
      Object.entries(request.headers).flatMap(([name, value]) =>
        NOT_FORWARDED.has(name) || value === undefined
          ? []
          : [[name, Array.isArray(value) ? value.join(", ") : value]]
      )
    ),
    // Plain bodies, so recordings hold what the Endpoint meant rather than compressed bytes.
    "accept-encoding": "identity",
  }),
  isLocalAddress = (address: string): boolean =>
    LOCAL_ADDRESSES.check(address, isIP(address) === 6 ? "ipv6" : "ipv4"),
  /**
   * Resolves like `dns.lookup` but fails when any answer is local. It runs as the socket
   * connects, so a DNS answer that changes after a check cannot swap in a local address.
   */
  guardedLookup: LookupFunction = (hostname, options, callback) => {
    dnsLookup(hostname, options, (error, address, family) => {
      if (error) {
        callback(error, address, family);
        return;
      }
      const local = (
        Array.isArray(address)
          ? address.map((entry) => entry.address)
          : [address]
      ).find(isLocalAddress);
      callback(
        local === undefined
          ? null
          : new LocalTargetError(`${hostname} resolves to ${local}`),
        address,
        family
      );
    });
  },
  /** Sends one request to an Endpoint; local addresses are refused unless `allowLocal`. */
  send = (
    target: URL,
    {
      allowLocal,
      body,
      headers,
      method,
    }: {
      allowLocal: boolean;
      body: Uint8Array;
      headers: Record<string, string>;
      method: string;
    }
  ): Promise<IncomingMessage> =>
    new Promise((resolve, reject) => {
      const literal = target.hostname.replaceAll(/^\[|\]$/gu, "");
      // Sockets skip the lookup for an IP address, so a literal one is checked here.
      if (!allowLocal && isIP(literal) !== 0 && isLocalAddress(literal)) {
        reject(new LocalTargetError(`${literal} is a local address`));
        return;
      }
      const upstream = (
        target.protocol === "https:" ? httpsRequest : httpRequest
      )(
        target,
        { headers, method, ...(allowLocal ? {} : { lookup: guardedLookup }) },
        resolve
      );
      upstream.on("error", reject);
      upstream.end(body.byteLength === 0 ? undefined : body);
    }),
  /** Answers the page when its Endpoint could not be called: refused when local, unreachable otherwise. */
  answerFailure = (response: ServerResponse, error: Error): void => {
    const local = error instanceof LocalTargetError;
    response.writeHead(local ? 403 : 502, plainText);
    response.end(
      local
        ? `Sauce Control does not relay calls to local addresses: ${error.message}.`
        : `Endpoint unreachable: ${error.message}`
    );
  },
  /** Calls the Endpoint a page asked for, answers the page with its response, and records the call. */
  callEndpoint = async (
    request: IncomingMessage,
    response: ServerResponse,
    role: InstanceRole,
    {
      localEndpointOrigins = [],
      recordEndpoint,
    }: Pick<ProxyRequest, "localEndpointOrigins" | "recordEndpoint">
  ): Promise<void> => {
    const target = endpointTarget(request.url ?? "");
    if (target === undefined) {
      response.writeHead(400, plainText);
      response.end("The Endpoint URL must be an absolute http or https URL.");
      return;
    }
    const method = request.method ?? "GET",
      requestHeaders = forwardedHeaders(request),
      requestBody = new Uint8Array(await collect(request));
    let upstream: IncomingMessage;
    try {
      upstream = await send(target, {
        allowLocal: localEndpointOrigins.includes(target.origin),
        body: requestBody,
        headers: requestHeaders,
        method,
      });
    } catch (error) {
      answerFailure(response, error as Error);
      return;
    }
    const status = upstream.statusCode ?? 502,
      responseBody = new Uint8Array(await collect(upstream)),
      { location } = upstream.headers;
    response.writeHead(status, {
      ...Object.fromEntries(
        Object.entries(upstream.headers).filter(
          ([name]) => !NOT_RETURNED.has(name)
        )
      ),
      "content-length": String(responseBody.byteLength),
      // The browser follows a redirect back through the route, so every hop is checked and recorded.
      ...(location === undefined
        ? {}
        : {
            location: `${ENDPOINT_ROUTE}?url=${encodeURIComponent(new URL(location, target).href)}`,
          }),
    });
    response.end(responseBody);
    try {
      recordEndpoint?.({
        method,
        requestBody,
        requestHeaders,
        responseBody,
        responseHeaders: upstream.headers,
        role,
        status,
        url: target.href,
      });
    } catch (error) {
      // A lost recording must not break the page that made the call.
      console.error(`Could not record ${method} ${target.href}:`, error);
    }
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
  localEndpointOrigins,
  recordEndpoint,
}: ProxyRequest): Promise<Proxy> => {
  const jar = createCookieJar(),
    servers = await Promise.all(
      INSTANCE_ROLES.map(async (role) => ({
        role,
        server: await listen((request, response) => {
          const path = request.url ?? "/";
          if (isEndpointRoute(path)) {
            callEndpoint(request, response, role, {
              ...(localEndpointOrigins === undefined
                ? {}
                : { localEndpointOrigins }),
              ...(recordEndpoint === undefined ? {} : { recordEndpoint }),
            }).catch((error: Error) => {
              if (!response.headersSent) {
                response.writeHead(502, plainText);
              }
              response.end(`Endpoint call failed: ${error.message}`);
            });
            return;
          }
          forward(
            request,
            response,
            instances[role].hostPort,
            path,
            injection,
            jar
          );
        }),
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
