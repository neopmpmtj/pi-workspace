import { IMAGE_DESCRIBER_PAGE, siteAgents } from "./agents.ts";

function navLabel(id: string, name: string): string {
  return id === "cos" ? "Cos" : name;
}

/** One set of links for the project site. Shell pages and proxied dashboards both use it. */
export const SHELL_LINKS: readonly { href: string; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/settings", label: "Settings" },
  ...siteAgents().map((agent) => ({ href: agent.sitePath as string, label: navLabel(agent.id, agent.name) })),
  { href: IMAGE_DESCRIBER_PAGE, label: "Image describer" },
];

/** "/" is only the home page. A section matches itself and everything under it. */
export function shellLinkCurrent(href: string, current: string): boolean {
  if (href.startsWith("http") || current === "") return false;
  if (href === "/") return current === "/";
  const base = href.endsWith("/") ? href.slice(0, -1) : href;
  return current === base || current.startsWith(`${base}/`);
}

export function shellNavAnchors(current = ""): string {
  return SHELL_LINKS.map((link) => {
    const on = shellLinkCurrent(link.href, current) ? ' aria-current="page"' : "";
    return `<a href="${link.href}"${on}>${escapeHtml(link.label)}</a>`;
  }).join("");
}

/**
 * Same colors as `.pi-shell` in control/public/style.css.
 * Proxied dashboards do not load that file, and their body is a centered column,
 * so this copy also pulls the bar out to the window edges.
 */
const SHELL_BAR_STYLE = [
  "html{overflow-x:clip}",
  "body{padding-top:0 !important}",
  ".pi-shell{display:flex;flex-wrap:wrap;gap:4px;align-items:center;box-sizing:border-box;width:100vw;margin:0 0 16px;margin-left:calc(50% - 50vw);margin-right:calc(50% - 50vw);padding:8px 16px;background:#1d2128;border-bottom:1px solid #313844;font:14px \"Segoe UI\",sans-serif}",
  ".pi-shell a{color:#9aa6b2;text-decoration:none;padding:4px 10px;border-radius:4px}",
  ".pi-shell a[aria-current=\"page\"]{color:#e7ecf2;background:#313844}",
].join("");

/** Bar injected into a dashboard page that does not load this site's stylesheet. */
export function shellNavBar(current = ""): string {
  return `<nav class="pi-shell" aria-label="Site">${shellNavAnchors(current)}</nav><style>${SHELL_BAR_STYLE}</style>`;
}

export function injectShellBar(html: string, current = ""): string {
  const bar = shellNavBar(current);
  const next = html.replace(/<body(\s[^>]*)?>/i, (tag) => `${tag}\n${bar}`);
  return next === html ? bar + html : next;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    return "&quot;";
  });
}
