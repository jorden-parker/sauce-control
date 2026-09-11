// Each test builds its own JSDOM window so injected listeners never leak between tests.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { type SyncMessage, syncScriptSource } from "./sync-script";

/** A frame after the Proxy injected the sync script: the page's HTML plus what it posted to the parent. */
const frame = (body: string) => {
    const posted: SyncMessage[] = [],
      { window: win } = new JSDOM(
        `<!doctype html><html><body>${body}</body></html>`,
        {
          runScripts: "outside-only",
          url: "http://localhost/",
        }
      );
    // The script posts to `parent`; in a lone window that is the window itself.
    win.postMessage = ((message: SyncMessage) => posted.push(message)) as never;
    win.eval(syncScriptSource());
    return {
      document: win.document,
      posted,
      /** The parent forwarding a sibling's event into this frame. */
      replay: (event: SyncMessage["event"]) =>
        win.dispatchEvent(
          new win.MessageEvent("message", {
            data: { event, source: "sauce-control", type: "replay" },
          })
        ),
      window: win,
    };
  },
  click = (element: Element) =>
    element.dispatchEvent(
      new element.ownerDocument.defaultView!.MouseEvent("click", {
        bubbles: true,
      })
    ),
  /** Ids of the elements clicked in a frame from now on. */
  clicks = (document: Document): string[] => {
    const seen: string[] = [];
    document.addEventListener("click", (event) => {
      seen.push((event.target as Element).id);
    });
    return seen;
  };

describe("serialising interactions for the sibling", () => {
  it("posts a click with the target's role and name, test id, and CSS path", () => {
    const { document, posted } = frame(
      `<main><form><button data-testid="save-button" class="primary">Save</button></form></main>`
    );
    click(document.querySelector("button")!);
    expect(posted).toEqual([
      {
        event: {
          kind: "click",
          target: {
            cssPath: "main > form > button",
            name: "Save",
            role: "button",
            testId: "save-button",
          },
        },
        source: "sauce-control",
        type: "event",
      },
    ]);
  });
});

describe("replaying the sibling's interactions", () => {
  it("finds the counterpart by role and name even when it moved and lost its test id", () => {
    const { document, posted, replay } = frame(
        `<nav><a href="/about" id="moved">About us</a></nav><div><a href="/x">Other</a></div>`
      ),
      seen = clicks(document);
    replay({
      kind: "click",
      target: {
        cssPath: "div > a",
        name: "About us",
        role: "link",
        testId: "about-link",
      },
    });
    expect(seen).toEqual(["moved"]);
    expect(posted).toEqual([]);
  });

  it("falls back to the test id, then the CSS path", () => {
    const { document, replay } = frame(
        `<div><span data-testid="badge" id="by-test-id">42</span></div><p><em id="by-path">x</em></p>`
      ),
      seen = clicks(document);
    replay({
      kind: "click",
      target: {
        cssPath: "div > span",
        name: "Old",
        role: "button",
        testId: "badge",
      },
    });
    replay({
      kind: "click",
      target: {
        cssPath: "p > em",
        name: "Old",
        role: "button",
        testId: "gone",
      },
    });
    expect(seen).toEqual(["by-test-id", "by-path"]);
  });

  it("reports a desync when no strategy matches, without touching the page", () => {
    const { document, posted, replay } = frame(
        `<div><button id="other">Other</button></div>`
      ),
      seen = clicks(document),
      target = {
        cssPath: "div > button:nth-of-type(2)",
        name: "Delete",
        role: "button",
      };
    replay({ kind: "click", target });
    expect(seen).toEqual([]);
    expect(posted).toEqual([
      {
        event: { kind: "click", target },
        source: "sauce-control",
        type: "desync",
      },
    ]);
  });
});

describe("text input", () => {
  it("posts the field's value as typed and the sibling takes it on with an input event", () => {
    const origin = frame(
        `<label for="email">Email</label><input id="email" type="email">`
      ),
      sibling = frame(
        `<label for="email">Email</label><input id="email" type="email"><input id="other">`
      ),
      field = origin.document.querySelector("input")!,
      siblingField = sibling.document.querySelector("input")!,
      inputs: string[] = [];
    siblingField.addEventListener("input", () =>
      inputs.push(siblingField.value)
    );
    field.value = "ada@example.com";
    field.dispatchEvent(new origin.window.Event("input", { bubbles: true }));

    expect(origin.posted).toEqual([
      {
        event: {
          kind: "input",
          target: {
            cssPath: "input",
            name: "Email",
            role: "textbox",
          },
          value: "ada@example.com",
        },
        source: "sauce-control",
        type: "event",
      },
    ]);
    sibling.replay(origin.posted[0]!.event);
    expect(siblingField.value).toBe("ada@example.com");
    expect(inputs).toEqual(["ada@example.com"]);
    expect(sibling.posted).toEqual([]);
  });

  it("replays a checkbox by its checked state", () => {
    const origin = frame(`<label><input type="checkbox">Agree</label>`),
      sibling = frame(`<label><input type="checkbox">Agree</label>`),
      box = origin.document.querySelector("input")!;
    box.checked = true;
    box.dispatchEvent(new origin.window.Event("change", { bubbles: true }));
    expect(origin.posted[0]!.event).toMatchObject({
      checked: true,
      kind: "input",
      target: { name: "Agree", role: "checkbox" },
    });
    sibling.replay(origin.posted[0]!.event);
    expect(sibling.document.querySelector("input")!.checked).toBe(true);
  });
});

describe("focus, hover, and scroll", () => {
  it("focuses the counterpart when a field gains focus", () => {
    const origin = frame(`<input aria-label="Search">`),
      sibling = frame(`<p>moved</p><input aria-label="Search">`);
    origin.document.querySelector("input")!.focus();
    expect(origin.posted[0]!.event).toMatchObject({
      kind: "focus",
      target: { name: "Search", role: "textbox" },
    });
    sibling.replay(origin.posted[0]!.event);
    expect(sibling.document.activeElement).toBe(
      sibling.document.querySelector("input")
    );
    expect(sibling.posted).toEqual([]);
  });

  it("hovers the counterpart with a mouseover, once per element entered", () => {
    const origin = frame(`<ul><li>One</li><li>Two</li></ul>`),
      sibling = frame(`<ul><li>One</li><li>Two</li></ul>`),
      [first, second] = [...origin.document.querySelectorAll("li")],
      hovered: string[] = [];
    sibling.document.addEventListener("mouseover", (event) =>
      hovered.push((event.target as Element).textContent ?? "")
    );
    for (const element of [first, first, second]) {
      element!.dispatchEvent(
        new origin.window.MouseEvent("mouseover", { bubbles: true })
      );
    }
    expect(origin.posted.map((message) => message.event)).toMatchObject([
      { kind: "hover", target: { name: "One", role: "listitem" } },
      { kind: "hover", target: { name: "Two", role: "listitem" } },
    ]);
    for (const message of origin.posted) {
      sibling.replay(message.event);
    }
    expect(hovered).toEqual(["One", "Two"]);
    expect(sibling.posted).toEqual([]);
  });

  it("scrolls a container to the same offset and the window when the page scrolls", () => {
    const origin = frame(`<div id="pane" style="overflow:auto"></div>`),
      sibling = frame(`<div id="pane" style="overflow:auto"></div>`),
      pane = origin.document.querySelector("div")!,
      siblingPane = sibling.document.querySelector("div")!;
    pane.scrollTop = 120;
    pane.scrollLeft = 8;
    pane.dispatchEvent(new origin.window.Event("scroll"));
    Object.defineProperty(origin.window, "scrollY", { value: 300 });
    origin.document.dispatchEvent(new origin.window.Event("scroll"));

    expect(origin.posted.map((message) => message.event)).toEqual([
      { kind: "scroll", left: 8, target: { cssPath: "div" }, top: 120 },
      { kind: "scroll", left: 0, top: 300 },
    ]);
    const windowScrolls: [number, number][] = [];
    sibling.window.scrollTo = ((left: number, top: number) =>
      windowScrolls.push([left, top])) as never;
    for (const message of origin.posted) {
      sibling.replay(message.event);
    }
    expect([siblingPane.scrollLeft, siblingPane.scrollTop]).toEqual([8, 120]);
    expect(windowScrolls).toEqual([[0, 300]]);
  });
});

describe("navigation", () => {
  it("replays a pushState navigation the sibling has not made and ignores one it has", () => {
    const origin = frame(`<p>home</p>`),
      sibling = frame(`<p>home</p>`);
    origin.window.history.pushState({}, "", "/about?tab=2");
    expect(origin.posted.map((message) => message.event)).toEqual([
      { kind: "navigation", url: "/about?tab=2" },
    ]);
    sibling.replay(origin.posted[0]!.event);
    expect(
      sibling.window.location.pathname + sibling.window.location.search
    ).toBe("/about?tab=2");
    expect(sibling.posted).toEqual([]);
    sibling.replay(origin.posted[0]!.event);
    expect(sibling.window.history.length).toBe(2);
  });
});
