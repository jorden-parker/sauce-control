import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from "node:http";
import type { AddressInfo } from "node:net";
import { createContext, runInContext } from "node:vm";
import { type Browser, chromium } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openEndpointRecordings } from "@/endpoints/endpoint-recordings";
import { type Proxy, type ProxyRequest, startProxy } from "./proxy";

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
    handlers: { base?: Handler; target?: Handler } = {},
    options: Pick<ProxyRequest, "localEndpointOrigins" | "recordEndpoint"> = {}
  ): Promise<Proxy> => {
    const proxy = await startProxy({
      ...options,
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

/** A fixture upstream serving a page that runs `script` and shows its outcome in `#result`. */
const pageRunning =
    (script: string): Handler =>
    (_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        `<!doctype html><html><head></head><body><p id="result"></p><script>
var show = function (text) { document.getElementById("result").textContent = text; };
${script}
</script></body></html>`
      );
    },
  /** A fixture external API on its own port, so it is cross-origin to every Instance. */
  listenApi = (handler: Handler): Promise<string> =>
    listenUpstream("api", handler).then((port) => `http://127.0.0.1:${port}`),
  json =
    (body: unknown): Handler =>
    (_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(body));
    };

describe("recording Endpoints", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  /** Opens one Instance through the Proxy in a real browser and returns what its script showed. */
  const resultOf = async (url: string): Promise<string> => {
    const tab = await browser.newPage();
    try {
      await tab.goto(url);
      const result = tab.locator("#result");
      await result.filter({ hasText: /./u }).waitFor({ timeout: 5000 });
      return (await result.textContent()) ?? "";
    } finally {
      await tab.close();
    }
  };

  it("answers a page's cross-origin fetch through the Proxy and records the Endpoint", async () => {
    const api = await listenApi(json({ id: 7, name: "Ada" })),
      recordings = openEndpointRecordings(":memory:"),
      proxy = await startAll(
        {
          base: pageRunning(
            `fetch("${api}/users/7").then(function (r) { return r.text(); }).then(show, function (e) { show("failed: " + e); });`
          ),
        },
        {
          localEndpointOrigins: [api],
          recordEndpoint: (call) => recordings.record("web-app", call),
        }
      );
    await expect(resultOf(proxy.urlFor("base"))).resolves.toBe(
      '{"id":7,"name":"Ada"}'
    );
    expect(recordings.endpoints("web-app")).toEqual([
      { method: "GET", origin: api, pathPattern: "/users/{n}", samples: 1 },
    ]);
  });

  it("passes the page's Authorization to the Endpoint but stores no credential", async () => {
    const api = await listenApi((request, response) => {
        response.setHeader("set-cookie", "api_session=set-cookie-secret");
        response.end(`saw ${request.headers.authorization ?? "(none)"}`);
      }),
      recordings = openEndpointRecordings(":memory:"),
      proxy = await startAll(
        {
          base: pageRunning(
            `document.cookie = "session=cookie-secret";
fetch("${api}/me", { credentials: "include", headers: { Authorization: "Bearer secret-token" } })
  .then(function (r) { return r.text(); }).then(show, function (e) { show("failed: " + e); });`
          ),
        },
        {
          localEndpointOrigins: [api],
          recordEndpoint: (call) => recordings.record("web-app", call),
        }
      );
    await expect(resultOf(proxy.urlFor("base"))).resolves.toBe(
      "saw Bearer secret-token"
    );
    const [sample] = recordings.samples("web-app"),
      stored = JSON.stringify([
        sample?.requestHeaders,
        sample?.responseHeaders,
      ]);
    expect(sample?.requestHeaders.authorization).toBe("[redacted]");
    expect(sample?.responseHeaders["set-cookie"]).toBe("[redacted]");
    for (const secret of [
      "secret-token",
      "cookie-secret",
      "set-cookie-secret",
    ]) {
      expect(stored).not.toContain(secret);
    }
  });

  it("refuses to relay a call to a local address it was not told about", async () => {
    let reached = 0;
    const local = await listenUpstream(
        "local service",
        (_request, response) => {
          reached += 1;
          response.end("secret");
        }
      ),
      recordings = openEndpointRecordings(":memory:"),
      proxy = await startAll(
        {
          base: pageRunning(
            `Promise.all([
  "http://127.0.0.1:${local}/admin",
  "http://localhost:${local}/admin",
  "http://[::ffff:127.0.0.1]:${local}/admin"
].map(function (url) {
  return fetch(url).then(function (r) { return r.status; }, function () { return "failed"; });
})).then(function (statuses) { show(statuses.join(" ")); });`
          ),
        },
        { recordEndpoint: (call) => recordings.record("web-app", call) }
      );
    await expect(resultOf(proxy.urlFor("base"))).resolves.toBe("403 403 403");
    expect(reached).toBe(0);
    expect(recordings.samples("web-app")).toEqual([]);
  });

  it("follows an Endpoint's redirect back through the Proxy, recording each hop", async () => {
    const api = await listenApi((request, response) => {
        if (request.url === "/old") {
          response.writeHead(302, {
            location: `http://127.0.0.1:${request.socket.localPort}/users/7`,
          });
          response.end();
          return;
        }
        json({ id: 7 })(request, response);
      }),
      recordings = openEndpointRecordings(":memory:"),
      proxy = await startAll(
        {
          base: pageRunning(
            `fetch("${api}/old").then(function (r) { return r.text(); }).then(show, function (e) { show("failed: " + e); });`
          ),
        },
        {
          localEndpointOrigins: [api],
          recordEndpoint: (call) => recordings.record("web-app", call),
        }
      );
    await expect(resultOf(proxy.urlFor("base"))).resolves.toBe('{"id":7}');
    expect(
      recordings.samples("web-app").map(({ status, url }) => `${status} ${url}`)
    ).toEqual([`302 ${api}/old`, `200 ${api}/users/7`]);
  });

  it("still answers the page when recording the call fails", async () => {
    const api = await listenApi(json({ id: 7 })),
      proxy = await startAll(
        {
          base: pageRunning(
            `fetch("${api}/users/7").then(function (r) { return r.text(); }).then(show, function (e) { show("failed: " + e); });`
          ),
        },
        {
          localEndpointOrigins: [api],
          recordEndpoint: () => {
            throw new Error("database is locked");
          },
        }
      );
    await expect(resultOf(proxy.urlFor("base"))).resolves.toBe('{"id":7}');
    await expect(resultOf(proxy.urlFor("base"))).resolves.toBe('{"id":7}');
  });

  it("records an XMLHttpRequest from the Target Instance with the body it sent", async () => {
    const api = await listenApi((request, response) => {
        let body = "";
        request.on("data", (chunk: Buffer) => (body += chunk.toString()));
        request.on("end", () => {
          response.statusCode = 201;
          response.end(`${request.method} ${body}`);
        });
      }),
      recordings = openEndpointRecordings(":memory:"),
      proxy = await startAll(
        {
          target: pageRunning(
            `var xhr = new XMLHttpRequest();
xhr.open("POST", "${api}/users");
xhr.setRequestHeader("content-type", "application/json");
xhr.onload = function () { show(xhr.status + " " + xhr.responseText); };
xhr.onerror = function () { show("failed"); };
xhr.send('{"name":"Ada"}');`
          ),
        },
        {
          localEndpointOrigins: [api],
          recordEndpoint: (call) => recordings.record("web-app", call),
        }
      );
    await expect(resultOf(proxy.urlFor("target"))).resolves.toBe(
      '201 POST {"name":"Ada"}'
    );
    const [sample] = recordings.samples("web-app");
    expect(sample).toMatchObject({
      method: "POST",
      role: "target",
      status: 201,
      url: `${api}/users`,
    });
    expect(Buffer.from(sample!.requestBody).toString()).toBe('{"name":"Ada"}');
    expect(Buffer.from(sample!.responseBody).toString()).toBe(
      'POST {"name":"Ada"}'
    );
  });
});
