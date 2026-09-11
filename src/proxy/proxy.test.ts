import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from "node:http";
import type { AddressInfo } from "node:net";
import { createContext, runInContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { type Proxy, startProxy } from "./proxy";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const open: { close: () => Promise<void> }[] = [],
  /** A fixture upstream; the default one echoes which Instance it is plus the path it received. */
  listenUpstream = (
    name: string,
    handler: Handler = (request, response) => {
      response.setHeader("content-type", "text/plain");
      response.end(`${name} saw ${request.url}`);
    }
  ): Promise<number> =>
    new Promise((resolve) => {
      const server: Server = createServer(handler);
      server.listen(0, "127.0.0.1", () => {
        open.push({
          close: () =>
            new Promise<void>((done) => {
              server.close(() => done());
            }),
        });
        resolve((server.address() as AddressInfo).port);
      });
    }),
  startAll = async (
    handlers: { base?: Handler; target?: Handler } = {}
  ): Promise<Proxy> => {
    const proxy = await startProxy({
      instances: {
        base: { hostPort: await listenUpstream("base", handlers.base) },
        target: { hostPort: await listenUpstream("target", handlers.target) },
      },
    });
    open.push(proxy);
    return proxy;
  };

afterEach(async () => {
  await Promise.all(open.splice(0).map((closable) => closable.close()));
});

describe("routing through the Proxy", () => {
  it("serves each Instance on its own port at the root, so absolute links keep working", async () => {
    const proxy = await startAll();
    expect(proxy.ports.base).not.toBe(proxy.ports.target);
    expect(proxy.urlFor("base")).toBe(`http://127.0.0.1:${proxy.ports.base}/`);
    await expect(
      (await fetch(`${proxy.urlFor("base")}about?x=1`)).text()
    ).resolves.toBe("base saw /about?x=1");
    await expect(
      (await fetch(`${proxy.urlFor("target")}_next/static/app.js`)).text()
    ).resolves.toBe("target saw /_next/static/app.js");
  });

  it("stops serving both ports on close", async () => {
    const proxy = await startAll(),
      urls = [proxy.urlFor("base"), proxy.urlFor("target")];
    open.pop();
    await proxy.close();
    await Promise.all(urls.map((url) => expect(fetch(url)).rejects.toThrow()));
  });
});

/** A fixture upstream serving one HTML page. */
const page = (_request: IncomingMessage, response: ServerResponse) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(
    "<!doctype html><html><head><title>App</title></head><body>hi</body></html>"
  );
};

describe("rewriting HTML", () => {
  it("injects the determinism script and animation stylesheet at the top of head", async () => {
    const proxy = await startAll({ base: page }),
      response = await fetch(proxy.urlFor("base")),
      html = await response.text();
    expect(html).toMatch(
      /<head><script data-sauce-control="determinism">[\s\S]+<\/script><style data-sauce-control="animations">[\s\S]+<\/style>[\s\S]*<title>App<\/title>/u
    );
    expect(html).toContain("animation: none !important");
    expect(html).toContain("transition: none !important");
    expect(response.headers.get("content-length")).toBe(
      String(Buffer.byteLength(html))
    );
  });

  it("injects the sync script after the determinism shims", async () => {
    const proxy = await startAll({ base: page }),
      html = await (await fetch(proxy.urlFor("base"))).text();
    expect(html).toMatch(
      /<\/style><script data-sauce-control="sync">[\s\S]+parent\.postMessage[\s\S]+<\/script><title>/u
    );
  });

  it("rewrites chunked HTML, as dev servers send it, into one sized response", async () => {
    const proxy = await startAll({
        base: (_request, response) => {
          response.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "transfer-encoding": "chunked",
          });
          response.write("<!doctype html><html><head></head>");
          response.end("<body>chunked</body></html>");
        },
      }),
      response = await fetch(proxy.urlFor("base"));
    expect(response.headers.get("transfer-encoding")).toBeNull();
    await expect(response.text()).resolves.toContain("<body>chunked</body>");
  });

  it("leaves non-HTML responses untouched", async () => {
    const proxy = await startAll(),
      html = await (await fetch(proxy.urlFor("base"))).text();
    expect(html).toBe("base saw /");
  });
});

/** Runs the injected script in a fresh JS realm, as a browser would, and returns that realm's globals. */
const realmAfterInjection = async (proxy: Proxy, role: "base" | "target") => {
    const html = await (await fetch(proxy.urlFor(role))).text(),
      script =
        /<script data-sauce-control="determinism">([\s\S]+?)<\/script>/u.exec(
          html
        )?.[1] ?? "",
      context = createContext({});
    runInContext(script, context);
    return runInContext("({ Date, Math })", context) as {
      Date: DateConstructor;
      Math: Math;
    };
  },
  /** Five draws from a realm's Math.random. */
  draw = (realm: { Math: Math }) =>
    Array.from({ length: 5 }, () => realm.Math.random());

describe("determinism shims", () => {
  it("freezes Date.now and new Date() to one instant while explicit dates still work", async () => {
    const proxy = await startAll({ base: page }),
      { Date: FrozenDate } = await realmAfterInjection(proxy, "base");
    expect(FrozenDate.now()).toBe(Date.UTC(2024, 0, 15, 12, 0, 0));
    expect(new FrozenDate().toISOString()).toBe("2024-01-15T12:00:00.000Z");
    expect(new FrozenDate("2020-02-03T00:00:00Z").getTime()).toBe(
      Date.UTC(2020, 1, 3)
    );
    expect(new FrozenDate() instanceof FrozenDate).toBe(true);
  });

  it("gives both Instances the same Math.random sequence", async () => {
    const proxy = await startAll({ base: page, target: page }),
      base = await realmAfterInjection(proxy, "base"),
      target = await realmAfterInjection(proxy, "target"),
      baseDraws = draw(base);
    expect(draw(target)).toEqual(baseDraws);
    expect(new Set(baseDraws).size).toBe(5);
    for (const value of baseDraws) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

/** A fixture upstream that logs in with two cookies and otherwise echoes the Cookie header. */
const login = (request: IncomingMessage, response: ServerResponse) => {
  if (request.url === "/login") {
    response.setHeader("set-cookie", [
      "session=abc123; Path=/; HttpOnly",
      "theme=dark",
    ]);
    response.end("logged in");
    return;
  }
  response.end(`cookie: ${request.headers.cookie ?? "(none)"}`);
};

describe("one cookie jar for both Instances", () => {
  it("sends cookies set by one Instance to the other and keeps them out of the browser", async () => {
    const proxy = await startAll({ base: login, target: login }),
      loginResponse = await fetch(`${proxy.urlFor("base")}login`);
    expect(loginResponse.headers.get("set-cookie")).toBeNull();
    await expect(
      (await fetch(`${proxy.urlFor("target")}profile`)).text()
    ).resolves.toBe("cookie: session=abc123; theme=dark");
    await expect(
      (await fetch(`${proxy.urlFor("base")}profile`)).text()
    ).resolves.toBe("cookie: session=abc123; theme=dark");
  });

  it("overwrites a cookie set again and drops one that expires", async () => {
    const proxy = await startAll({
      base: (request, response) => {
        if (request.url === "/again") {
          response.setHeader("set-cookie", "session=new; Path=/");
        }
        if (request.url === "/logout") {
          response.setHeader("set-cookie", "session=; Max-Age=0");
        }
        response.end(`cookie: ${request.headers.cookie ?? "(none)"}`);
      },
    });
    await fetch(`${proxy.urlFor("base")}again`);
    await expect(
      (await fetch(`${proxy.urlFor("base")}profile`)).text()
    ).resolves.toBe("cookie: session=new");
    await fetch(`${proxy.urlFor("base")}logout`);
    await expect(
      (await fetch(`${proxy.urlFor("base")}profile`)).text()
    ).resolves.toBe("cookie: (none)");
  });
});
