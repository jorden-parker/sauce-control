import type { Interaction } from "./page";

/** Roles whose nodes discovery clicks, so react-aria apps without anchors are still explored. */
export const CLICKABLE_ROLES = [
  "link",
  "button",
  "menuitem",
  "tab",
  "option",
] as const;

/** One clickable node of an accessibility tree, in document order. */
export interface Candidate extends Interaction {
  /** `href` of a link, when the tree reports one. */
  url?: string;
}

const NODE = /^(\s*)- (link|button|menuitem|tab|option) "((?:[^"\\]|\\.)*)"/u,
  URL_LINE = /^\s*- \/url: (\S+)/u,
  unescape = (name: string): string => name.replaceAll(/\\(.)/gu, "$1");

/** Clickable nodes of a Playwright aria snapshot (its YAML form), with link targets. */
export const parseCandidates = (snapshot: string): Candidate[] => {
  const lines = snapshot.split("\n"),
    candidates: Candidate[] = [];
  for (const [index, line] of lines.entries()) {
    const node = NODE.exec(line);
    if (node === null) {
      continue;
    }
    const [, indent, role, name] = node as unknown as [
        string,
        string,
        Candidate["role"],
        string,
      ],
      next = lines[index + 1] ?? "",
      url = next.startsWith(`${indent}  `)
        ? URL_LINE.exec(next)?.[1]
        : undefined;
    candidates.push({
      name: unescape(name),
      role,
      ...(url === undefined ? {} : { url }),
    });
  }
  return candidates;
};
