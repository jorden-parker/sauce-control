/** How the sync script names an element so the sibling Instance can find its counterpart. */
export interface TargetDescriptor {
  /** Path of tag names from `<body>` down, with `:nth-of-type` where siblings share a tag. */
  cssPath: string;
  /** Accessible name of the closest element with a role. */
  name?: string;
  /** Accessibility role of the closest element with one. */
  role?: string;
  /** `data-testid` of the closest element carrying one. */
  testId?: string;
}

export type SyncEvent =
  | { kind: "click"; target: TargetDescriptor }
  | { kind: "focus"; target: TargetDescriptor }
  | { kind: "hover"; target: TargetDescriptor }
  | {
      checked?: boolean;
      kind: "input";
      target: TargetDescriptor;
      value: string;
    }
  /** Without a target, the window itself scrolled. */
  | { kind: "scroll"; left: number; target?: TargetDescriptor; top: number }
  /** Path, query, and hash after a history navigation. */
  | { kind: "navigation"; url: string };

/** What a frame posts to the parent, and what the parent forwards to the sibling frame. */
export type SyncMessage =
  | { event: SyncEvent; source: "sauce-control"; type: "event" }
  | { event: SyncEvent; source: "sauce-control"; type: "replay" }
  /** The receiving frame found no counterpart for the event's target. */
  | { event: SyncEvent; source: "sauce-control"; type: "desync" };

/* oxlint-disable unicorn/consistent-function-scoping -- every helper must live inside installSync so its toString() is self-contained */
/**
 * Runs inside each embedded Instance. Self-contained on purpose: it is serialised with
 * `Function.prototype.toString` and injected by the Proxy, so it must not reference anything
 * outside its own body.
 */
const installSync = (): void => {
  const SOURCE = "sauce-control",
    IMPLICIT_ROLES: Record<string, string> = {
      a: "link",
      article: "article",
      button: "button",
      dialog: "dialog",
      footer: "contentinfo",
      form: "form",
      h1: "heading",
      h2: "heading",
      h3: "heading",
      h4: "heading",
      h5: "heading",
      h6: "heading",
      header: "banner",
      hr: "separator",
      img: "img",
      li: "listitem",
      main: "main",
      nav: "navigation",
      ol: "list",
      option: "option",
      progress: "progressbar",
      select: "combobox",
      summary: "button",
      table: "table",
      textarea: "textbox",
      ul: "list",
    },
    INPUT_ROLES: Record<string, string> = {
      button: "button",
      checkbox: "checkbox",
      image: "button",
      number: "spinbutton",
      radio: "radio",
      range: "slider",
      reset: "button",
      search: "searchbox",
      submit: "button",
    },
    collapse = (text: string | null | undefined): string =>
      (text ?? "").replaceAll(/\s+/gu, " ").trim().slice(0, 200),
    roleOf = (element: Element): string | undefined => {
      const explicit = element.getAttribute("role");
      if (explicit) {
        return explicit.split(" ")[0];
      }
      const tag = element.tagName.toLowerCase();
      if (tag === "input") {
        const type = (element.getAttribute("type") ?? "text").toLowerCase();
        return type === "hidden" ? undefined : (INPUT_ROLES[type] ?? "textbox");
      }
      if (tag === "a") {
        return element.hasAttribute("href") ? "link" : undefined;
      }
      if (tag === "select") {
        return element.hasAttribute("multiple") ||
          Number(element.getAttribute("size")) > 1
          ? "listbox"
          : "combobox";
      }
      return IMPLICIT_ROLES[tag];
    },
    labelText = (element: Element): string => {
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        return collapse(
          labelledBy
            .split(/\s+/u)
            .map((id) => document.querySelector(`#${id}`)?.textContent ?? "")
            .join(" ")
        );
      }
      const { labels } = element as HTMLInputElement;
      if (labels && labels.length > 0) {
        return collapse(
          [...labels].map((label) => label.textContent).join(" ")
        );
      }
      return "";
    },
    nameOf = (element: Element): string => {
      const ariaLabel = collapse(element.getAttribute("aria-label"));
      if (ariaLabel) {
        return ariaLabel;
      }
      const tag = element.tagName.toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") {
        const type = (element.getAttribute("type") ?? "").toLowerCase();
        if (["button", "submit", "reset"].includes(type)) {
          return collapse((element as HTMLInputElement).value);
        }
        return (
          labelText(element) ||
          collapse(element.getAttribute("placeholder")) ||
          collapse(element.getAttribute("title"))
        );
      }
      if (tag === "img") {
        return collapse(element.getAttribute("alt"));
      }
      return (
        labelText(element) ||
        collapse(element.textContent) ||
        collapse(element.getAttribute("title"))
      );
    },
    cssPathOf = (element: Element): string => {
      const parts: string[] = [];
      for (
        let current: Element | null = element;
        current &&
        current !== document.body &&
        current !== document.documentElement;
        current = current.parentElement
      ) {
        const tag = current.tagName.toLowerCase(),
          siblings = current.parentElement
            ? [...current.parentElement.children].filter(
                (sibling) => sibling.tagName === current!.tagName
              )
            : [current];
        parts.unshift(
          siblings.length > 1
            ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})`
            : tag
        );
      }
      return parts.join(" > ");
    },
    describe = (element: Element): TargetDescriptor => {
      const descriptor: TargetDescriptor = { cssPath: cssPathOf(element) },
        withTestId = element.closest<HTMLElement>("[data-testid]");
      if (withTestId) {
        descriptor.testId = withTestId.dataset.testid ?? undefined;
      }
      for (
        let current: Element | null = element;
        current && current !== document.body;
        current = current.parentElement
      ) {
        const role = roleOf(current);
        if (role) {
          descriptor.role = role;
          descriptor.name = nameOf(current);
          break;
        }
      }
      return descriptor;
    },
    post = (message: SyncMessage): void => {
      window.parent.postMessage(message, "*");
    },
    /** Set while a replay runs, so the events it causes are not echoed back. */
    state: {
      hovered: Element | undefined;
      replayHovered: Element | undefined;
      replaying: boolean;
    } = { hovered: undefined, replayHovered: undefined, replaying: false },
    /** Scroll events arrive after the replay, so echoes are recognised by position instead. */
    replayedScrolls = new WeakMap<EventTarget, { left: number; top: number }>(),
    byRoleAndName = ({ name, role }: TargetDescriptor): Element | undefined =>
      role === undefined
        ? undefined
        : [...document.querySelectorAll("*")].find(
            (candidate) =>
              roleOf(candidate) === role && nameOf(candidate) === name
          ),
    byTestId = ({ testId }: TargetDescriptor): Element | undefined =>
      testId === undefined
        ? undefined
        : (document.querySelector(
            `[data-testid="${testId.replaceAll('"', String.raw`\"`)}"]`
          ) ?? undefined),
    byCssPath = ({ cssPath }: TargetDescriptor): Element | undefined => {
      try {
        return document.body.querySelector(cssPath) ?? undefined;
      } catch {
        return undefined;
      }
    },
    /** Role and accessible name first, then test id, then CSS path. */
    resolve = (target: TargetDescriptor): Element | undefined =>
      byRoleAndName(target) ?? byTestId(target) ?? byCssPath(target),
    isField = (
      element: Element
    ): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement,
    /** Sets through the prototype setter so frameworks watching the element notice. */
    setNative = (element: Element, property: string, value: unknown): void => {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(element) as object,
        property
      )?.set;
      if (setter) {
        setter.call(element, value);
      } else {
        (element as unknown as Record<string, unknown>)[property] = value;
      }
    },
    replayClick = (element: Element): void => {
      if (element instanceof HTMLElement) {
        element.click();
      } else {
        element.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
      }
    },
    /** No-op when the field already holds the value, so a replay never flips a toggle back. */
    replayInput = (
      element: Element,
      event: Extract<SyncEvent, { kind: "input" }>
    ): void => {
      if (!isField(element)) {
        return;
      }
      const isCheck =
          element instanceof HTMLInputElement && event.checked !== undefined,
        unchanged = isCheck
          ? (element as HTMLInputElement).checked === event.checked
          : element.value === event.value;
      if (unchanged) {
        return;
      }
      if (isCheck) {
        setNative(element, "checked", event.checked);
      } else {
        setNative(element, "value", event.value);
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    },
    mouse = (type: string, bubbles: boolean): MouseEvent =>
      new MouseEvent(type, { bubbles, cancelable: true }),
    replayHover = (element: Element): void => {
      const previous = state.replayHovered;
      if (previous === element) {
        return;
      }
      if (previous) {
        previous.dispatchEvent(mouse("mouseout", true));
        previous.dispatchEvent(mouse("mouseleave", false));
      }
      state.replayHovered = element;
      element.dispatchEvent(mouse("mouseover", true));
      element.dispatchEvent(mouse("mouseenter", false));
    },
    replayScroll = (
      element: Element | undefined,
      { left, top }: { left: number; top: number }
    ): void => {
      if (element === undefined) {
        replayedScrolls.set(document, { left, top });
        window.scrollTo(left, top);
        return;
      }
      if (element.scrollLeft === left && element.scrollTop === top) {
        return;
      }
      replayedScrolls.set(element, { left, top });
      element.scrollLeft = left;
      element.scrollTop = top;
    },
    currentUrl = (): string =>
      location.pathname + location.search + location.hash,
    replayNavigation = (url: string): void => {
      if (currentUrl() === url) {
        return;
      }
      history.pushState(null, "", url);
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    },
    replay = (event: SyncEvent): void => {
      const element =
        "target" in event && event.target !== undefined
          ? resolve(event.target)
          : undefined;
      if (
        element === undefined &&
        event.kind !== "navigation" &&
        !(event.kind === "scroll" && event.target === undefined)
      ) {
        post({ event, source: SOURCE, type: "desync" });
        return;
      }
      state.replaying = true;
      try {
        switch (event.kind) {
          case "click": {
            replayClick(element!);
            break;
          }
          case "input": {
            replayInput(element!, event);
            break;
          }
          case "focus": {
            (element as HTMLElement).focus({ preventScroll: true });
            break;
          }
          case "hover": {
            replayHover(element!);
            break;
          }
          case "scroll": {
            replayScroll(element, event);
            break;
          }
          case "navigation": {
            replayNavigation(event.url);
            break;
          }
        }
      } finally {
        state.replaying = false;
      }
    },
    elementOf = (event: Event): Element | undefined => {
      const { target } = event;
      return target instanceof Element ? target : undefined;
    },
    emit = (event: SyncEvent): void => {
      if (!state.replaying) {
        post({ event, source: SOURCE, type: "event" });
      }
    },
    onInput = (event: Event): void => {
      const element = elementOf(event);
      if (!element || !isField(element)) {
        return;
      }
      const checked =
        element instanceof HTMLInputElement &&
        (element.type === "checkbox" || element.type === "radio")
          ? element.checked
          : undefined;
      emit({
        ...(checked === undefined ? {} : { checked }),
        kind: "input",
        target: describe(element),
        value: element.value,
      });
    };

  document.addEventListener(
    "click",
    (event) => {
      const element = elementOf(event);
      if (element) {
        emit({ kind: "click", target: describe(element) });
      }
    },
    true
  );
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onInput, true);
  document.addEventListener(
    "focus",
    (event) => {
      const element = elementOf(event);
      if (element) {
        emit({ kind: "focus", target: describe(element) });
      }
    },
    true
  );
  document.addEventListener(
    "mouseover",
    (event) => {
      const element = elementOf(event);
      if (element && element !== state.hovered) {
        state.hovered = element;
        emit({ kind: "hover", target: describe(element) });
      }
    },
    true
  );
  document.addEventListener(
    "scroll",
    (event) => {
      const { target } = event,
        position =
          target instanceof Element
            ? { left: target.scrollLeft, top: target.scrollTop }
            : { left: window.scrollX, top: window.scrollY },
        replayed = target ? replayedScrolls.get(target) : undefined;
      if (
        replayed &&
        replayed.left === position.left &&
        replayed.top === position.top
      ) {
        replayedScrolls.delete(target!);
        return;
      }
      emit({
        kind: "scroll",
        ...(target instanceof Element ? { target: describe(target) } : {}),
        ...position,
      });
    },
    true
  );

  const emitNavigation = (): void => {
      emit({ kind: "navigation", url: currentUrl() });
    },
    patchHistory = (method: "pushState" | "replaceState"): void => {
      const original = history[method].bind(history);
      history[method] = (...args: Parameters<History["pushState"]>) => {
        original(...args);
        emitNavigation();
      };
    };
  patchHistory("pushState");
  patchHistory("replaceState");
  window.addEventListener("popstate", emitNavigation);
  window.addEventListener("hashchange", emitNavigation);

  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data as Partial<SyncMessage> | null;
    if (
      data &&
      data.source === SOURCE &&
      data.type === "replay" &&
      data.event !== undefined
    ) {
      replay(data.event);
    }
  });
};

/** The injected script: the self-contained installer, invoked at once. */
export const syncScriptSource = (): string => `(${installSync.toString()})();`;
