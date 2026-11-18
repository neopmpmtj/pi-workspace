import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readInputContainsUrl } from "./global-config.ts";

/** The first URL in a prompt. file:// and content:// belong to the path gate. */
export interface InputUrl {
  url: string;
  scheme: string;
  name: string;
  extension: string;
  tld: string;
}

const TRAIL = /[.,;:!?)\]]+$/u;

/** First accepted URL, or null when the text has none. A host.tld needs no scheme. */
export function inputContainsUrl(text: string): InputUrl | null {
  for (let i = 0; i < text.length; i++) {
    const hit = matchUrlAt(text, i);
    if (hit) return hit.found;
  }
  return null;
}

/** End index of a URL starting at i, or i when the text there is not a URL. */
export function urlSpanEnd(text: string, i: number): number {
  return matchUrlAt(text, i)?.end ?? i;
}

/** Labeled lines sent with the prompt. A miss keeps the labels and empty fields. */
export function inputContainsUrlLines(found: InputUrl | null): string {
  return [
    "inputContainsUrl",
    `found: ${found ? "true" : "false"}`,
    `url: ${found?.url ?? ""}`,
    `scheme: ${found?.scheme ?? ""}`,
    `name: ${found?.name ?? ""}`,
    `extension: ${found?.extension ?? ""}`,
    `tld: ${found?.tld ?? ""}`,
  ].join("\n");
}

const FILE_SUFFIX = new Set([
  "jpeg", "jpg", "png", "gif", "webp", "bmp", "svg", "ico", "heic", "heif", "tif", "tiff",
  "xlsx", "xls", "csv", "pdf", "doc", "docx", "ppt", "pptx", "txt", "md", "rtf",
  "zip", "gz", "tgz", "tar", "7z", "rar",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "html", "htm", "css", "xml", "yaml", "yml",
  "mp3", "mp4", "wav", "avi", "mov", "mkv", "webm",
  "py", "go", "rs", "java", "c", "cpp", "h", "sh",
]);

interface UrlHit {
  found: InputUrl;
  end: number;
}

function matchUrlAt(text: string, i: number): UrlHit | null {
  if (!isBoundary(text, i)) return null;
  const schemeMatch = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(text.slice(i));
  if (schemeMatch) {
    const scheme = schemeMatch[0].slice(0, -3).toLowerCase();
    if (scheme === "file" || scheme === "content") return null;
    let j = i + schemeMatch[0].length;
    while (j < text.length && !isSpace(text[j])) j++;
    const url = text.slice(i, j).replace(TRAIL, "");
    if (!url.toLowerCase().includes("://")) return null;
    return { found: describe(url, scheme), end: j };
  }
  const hostMatch = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/.exec(text.slice(i));
  if (!hostMatch) return null;
  const labels = hostMatch[0].split(".");
  const tld = labels[labels.length - 1] ?? "";
  if (!/^[A-Za-z]{2,}$/u.test(tld)) return null;
  let j = i + hostMatch[0].length;
  if (text[j] === ":" && /[0-9]/u.test(text[j + 1] ?? "")) {
    j += 1;
    while (j < text.length && /[0-9]/u.test(text[j] ?? "")) j += 1;
  }
  const afterHost = j;
  if (text[j] === "/" || text[j] === "?" || text[j] === "#") {
    while (j < text.length && !isSpace(text[j])) j += 1;
  }
  if (text[afterHost] !== "/" && FILE_SUFFIX.has(tld.toLowerCase())) return null;
  const url = text.slice(i, j).replace(TRAIL, "");
  if (!url.includes(".")) return null;
  return { found: describe(url, ""), end: j };
}

function describe(url: string, scheme: string): InputUrl {
  const bare = (url.split(/[?#]/u)[0] ?? "").replace(TRAIL, "");
  const marker = bare.indexOf("://");
  const after = marker >= 0 ? bare.slice(marker + 3) : bare;
  const slash = after.indexOf("/");
  const host = (slash < 0 ? after : after.slice(0, slash)).replace(/:\d+$/u, "");
  const labels = host.split(".").filter((label) => label.length > 0);
  const tld = (labels[labels.length - 1] ?? "").toLowerCase();
  const segments = (slash < 0 ? "" : after.slice(slash)).replace(/\/+$/u, "").split("/").filter((part) => part.length > 0);
  const last = segments[segments.length - 1] ?? "";
  const dot = last.lastIndexOf(".");
  if (dot > 0) {
    return { url, scheme, name: last, extension: last.slice(dot + 1).toLowerCase(), tld };
  }
  return { url, scheme, name: labels[0] ?? "", extension: "", tld };
}

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/u.test(ch);
}

function isBoundary(text: string, i: number): boolean {
  if (i <= 0) return true;
  return /[\s("'([{]/u.test(text[i - 1] ?? "");
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  const setting = await readInputContainsUrl();
  if (setting?.print) {
    const text = readFileSync(0, "utf8");
    process.stdout.write(inputContainsUrl(text) ? "true\n" : "false\n");
  }
}
