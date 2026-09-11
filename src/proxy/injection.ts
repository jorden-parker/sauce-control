import { syncScriptSource } from "@/sync/sync-script";

/** What the Proxy adds to every HTML page so both Instances behave identically. */
export interface Injection {
  /** Epoch milliseconds every `Date.now()` and `new Date()` report. */
  fixedNowMs: number;
  /** Seed for the deterministic `Math.random`. */
  randomSeed: number;
}

/** Freezes time and seeds randomness (mulberry32) before any application script runs. */
export const determinismScript = ({
  fixedNowMs,
  randomSeed,
}: Injection): string => `
(function () {
  var fixedNow = ${fixedNowMs};
  var RealDate = Date;
  function FixedDate() {
    if (arguments.length === 0) { return new RealDate(fixedNow); }
    return new (Function.prototype.bind.apply(RealDate, [null].concat(Array.prototype.slice.call(arguments))))();
  }
  FixedDate.prototype = RealDate.prototype;
  FixedDate.now = function () { return fixedNow; };
  FixedDate.parse = RealDate.parse;
  FixedDate.UTC = RealDate.UTC;
  globalThis.Date = FixedDate;
  var state = ${randomSeed} >>> 0;
  Math.random = function () {
    state = (state + 0x6D2B79F5) >>> 0;
    var t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();
`;

/** Where the Proxy answers an Endpoint call on behalf of the page; the target URL is in `url`. */
export const ENDPOINT_ROUTE = "/__sauce-control/endpoint";

/**
 * Sends every cross-origin `fetch` and `XMLHttpRequest` through the Proxy's own origin, so the
 * Proxy sees each Endpoint call. Same-origin requests are the application's own routes and go
 * straight through.
 */
export const endpointScript = `
(function () {
  var route = location.origin + "${ENDPOINT_ROUTE}?url=";
  function reroute(input) {
    var url;
    try { url = new URL(input, document.baseURI); } catch (error) { return undefined; }
    if (url.origin === location.origin || (url.protocol !== "http:" && url.protocol !== "https:")) { return undefined; }
    return route + encodeURIComponent(url.href);
  }
  if (typeof fetch === "function") {
    var realFetch = fetch.bind(globalThis);
    globalThis.fetch = function (input, init) {
      var isRequest = typeof Request === "function" && input instanceof Request;
      var routed = reroute(isRequest ? input.url : String(input));
      if (routed === undefined) { return realFetch(input, init); }
      return realFetch(isRequest ? new Request(routed, input) : routed, init);
    };
  }
  if (typeof XMLHttpRequest === "function") {
    var realOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      var args = Array.prototype.slice.call(arguments);
      var routed = reroute(String(url));
      if (routed !== undefined) { args[1] = routed; }
      return realOpen.apply(this, args);
    };
  }
})();
`;

export const animationStylesheet = `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  scroll-behavior: auto !important;
  caret-color: transparent !important;
}
`;

/** Inserts the scripts and stylesheet at the top of `<head>`, or before everything when there is none. */
export const injectIntoHtml = (html: string, injection: Injection): string => {
  const block =
      `<script data-sauce-control="determinism">${determinismScript(injection)}</script>` +
      `<style data-sauce-control="animations">${animationStylesheet}</style>` +
      `<script data-sauce-control="sync">${syncScriptSource()}</script>` +
      `<script data-sauce-control="endpoints">${endpointScript}</script>`,
    head = /<head[^>]*>/iu.exec(html);
  return head
    ? html.slice(0, head.index + head[0].length) +
        block +
        html.slice(head.index + head[0].length)
    : block + html;
};
