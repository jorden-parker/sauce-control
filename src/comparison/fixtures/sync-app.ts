import type { InstanceRole } from "@/proxy/proxy";

/**
 * The fixture app both stubbed Instances serve: one control per synced event kind, echoing
 * what happened so a test can read it from the sibling. The Target Branch moves the About
 * link into a footer and drops the Delete button, giving role-and-name resolution and the
 * desync case something to bite on.
 */
const shell = (title: string, body: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;padding:16px}#pane{height:100px;overflow:auto;border:1px solid #ccc}</style>
</head><body>${body}</body></html>`,
  aboutLink = (role: InstanceRole): string =>
    role === "base"
      ? `<nav><a href="/about">About</a></nav>`
      : `<footer class="links"><a href="/about">About</a></footer>`,
  deleteButton = (role: InstanceRole): string =>
    role === "base" ? `<button data-testid="delete">Delete</button>` : "",
  home = (role: InstanceRole, apiOrigin: string): string =>
    shell(
      `Home (${role})`,
      `<h1>Home (${role})</h1>
${aboutLink(role)}
<p><label for="name">Name</label> <input id="name"> <span id="name-echo"></span></p>
<p>Focused: <span id="focus-echo"></span></p>
<div id="hover-box">Hover me</div><p id="hover-echo"></p>
<div id="pane"><div style="height:1000px"></div></div><p id="scroll-echo"></p>
<button id="open-panel">Open panel</button> <span id="path-echo"></span>
${deleteButton(role)}
<script>
  var echo = function (id, text) { document.getElementById(id).textContent = text; };
  document.getElementById("name").addEventListener("input", function (event) { echo("name-echo", event.target.value); });
  document.addEventListener("focusin", function (event) { echo("focus-echo", event.target.id); });
  document.getElementById("hover-box").addEventListener("mouseover", function () { echo("hover-echo", "hovered"); });
  document.getElementById("pane").addEventListener("scroll", function (event) { echo("scroll-echo", String(event.target.scrollTop)); });
  var showPath = function () { echo("path-echo", location.pathname); };
  document.getElementById("open-panel").addEventListener("click", function () { history.pushState({}, "", "/panel"); showPath(); });
  window.addEventListener("popstate", showPath);
  fetch("${apiOrigin}/users/7").catch(function () {});
</script>`
    ),
  about = (role: InstanceRole): string =>
    shell(
      `About (${role})`,
      `<h1>About (${role})</h1><nav><a href="/">Home</a></nav>`
    );

/** The fixture page for a path, or undefined for a 404. Home calls the fixture API at `apiOrigin` on load. */
export const syncAppPage = (
  role: InstanceRole,
  path: string,
  apiOrigin: string
): string | undefined => {
  const pathname = path.split("?")[0];
  if (pathname === "/" || pathname === "/panel") {
    return home(role, apiOrigin);
  }
  if (pathname === "/about") {
    return about(role);
  }
  return undefined;
};
