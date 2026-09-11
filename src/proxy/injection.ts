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

export const animationStylesheet = `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  scroll-behavior: auto !important;
  caret-color: transparent !important;
}
`;

/** Inserts the script and stylesheet at the top of `<head>`, or before everything when there is none. */
export const injectIntoHtml = (html: string, injection: Injection): string => {
  const block =
      `<script data-sauce-control="determinism">${determinismScript(injection)}</script>` +
      `<style data-sauce-control="animations">${animationStylesheet}</style>`,
    head = /<head[^>]*>/iu.exec(html);
  return head
    ? html.slice(0, head.index + head[0].length) +
        block +
        html.slice(head.index + head[0].length)
    : block + html;
};
