import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readInputContainsPath } from "./global-config.ts";
import { urlSpanEnd } from "./input-contains-url.ts";

/** The first filesystem path in a prompt, split for later context. */
export interface InputPath {
  path: string;
  name: string;
  extension: string;
}

interface Span {
  span: string;
  end: number;
}

const TRAIL = /[.,;:!?)\]]+$/u;

/** First accepted path, or null when the text has none. */
export function inputContainsPath(text: string): InputPath | null {
  return scan(text);
}

/** Labeled lines sent with the prompt. A miss keeps the labels and empty fields. */
export function inputContainsPathLines(found: InputPath | null): string {
  return [
    "inputContainsPath",
    `found: ${found ? "true" : "false"}`,
    `path: ${found?.path ?? ""}`,
    `name: ${found?.name ?? ""}`,
    `extension: ${found?.extension ?? ""}`,
  ].join("\n");
}

function scan(text: string): InputPath | null {
  for (let i = 0; i < text.length; i++) {
    const quote = text[i];
    if (quote === '"' || quote === "'") {
      const end = text.indexOf(quote, i + 1);
      if (end > i) {
        const inner = text.slice(i + 1, end);
        const whole = matchAt(inner, 0, true);
        if (whole && whole.end === inner.length) return toPath(stripTrail(whole.span));
        const nested = scan(inner);
        if (nested) return nested;
        i = end;
        continue;
      }
    }
    const skipped = skipWebUrl(text, i);
    if (skipped > i) {
      i = skipped - 1;
      continue;
    }
    const hit = matchAt(text, i, false);
    if (hit) return toPath(stripTrail(hit.span));
  }
  return null;
}

function matchAt(text: string, i: number, allowSpaces: boolean): Span | null {
  return matchFileUri(text, i) ?? matchDrive(text, i, allowSpaces) ?? matchUnc(text, i, allowSpaces) ?? matchRelative(text, i, allowSpaces) ?? matchPosix(text, i, allowSpaces);
}

function skipWebUrl(text: string, i: number): number {
  return urlSpanEnd(text, i);
}

function matchFileUri(text: string, i: number): Span | null {
  if (!isBoundary(text, i)) return null;
  const head = text.slice(i, i + 10).toLowerCase();
  const schemeLen = head.startsWith("content://") ? 10 : head.startsWith("file://") ? 7 : 0;
  if (schemeLen === 0) return null;
  let j = i + schemeLen;
  while (j < text.length && !isSpace(text[j])) j++;
  if (j === i + schemeLen) return null;
  return { span: text.slice(i, j), end: j };
}

function matchDrive(text: string, i: number, allowSpaces: boolean): Span | null {
  if (!isBoundary(text, i)) return null;
  let j = i;
  if (text.startsWith("\\\\?\\", i)) j = i + 4;
  if (!/[A-Za-z]/.test(text[j] ?? "")) return null;
  if (text[j + 1] !== ":") return null;
  if (text[j + 2] !== "/" && text[j + 2] !== "\\") return null;
  const first = readSegment(text, j + 3, allowSpaces);
  if (!first) return { span: text.slice(i, j + 3), end: j + 3 };
  return consumeSegments(text, i, first.end, allowSpaces);
}

function matchUnc(text: string, i: number, allowSpaces: boolean): Span | null {
  if (!isBoundary(text, i)) return null;
  const sep = text.startsWith("\\\\", i) ? "\\" : text.startsWith("//", i) ? "/" : "";
  if (!sep) return null;
  if (sep === "/" && schemeBefore(text, i)) return null;
  const server = readSegment(text, i + 2, allowSpaces);
  if (!server) return null;
  if (text[server.end] !== "/" && text[server.end] !== "\\") return null;
  const share = readSegment(text, server.end + 1, allowSpaces);
  if (!share) return null;
  return consumeSegments(text, i, share.end, allowSpaces);
}

function matchRelative(text: string, i: number, allowSpaces: boolean): Span | null {
  if (!isBoundary(text, i)) return null;
  let start = 0;
  if (text.startsWith("../", i) || text.startsWith("..\\", i)) start = i + 3;
  else if (text.startsWith("./", i) || text.startsWith(".\\", i)) start = i + 2;
  else if (text.startsWith("~/", i) || text.startsWith("~\\", i)) start = i + 2;
  else return null;
  const segment = readSegment(text, start, allowSpaces);
  if (!segment) return null;
  return consumeSegments(text, i, segment.end, allowSpaces);
}

function matchPosix(text: string, i: number, allowSpaces: boolean): Span | null {
  if (text[i] !== "/" || !isBoundary(text, i) || text[i + 1] === "/") return null;
  const segment = readSegment(text, i + 1, allowSpaces);
  if (!segment) return null;
  return consumeSegments(text, i, segment.end, allowSpaces);
}

function consumeSegments(text: string, from: number, end: number, allowSpaces: boolean): Span {
  let j = end;
  while (text[j] === "/" || text[j] === "\\") {
    const next = readSegment(text, j + 1, allowSpaces);
    if (!next) break;
    j = next.end;
  }
  return { span: text.slice(from, j), end: j };
}

function readSegment(text: string, i: number, allowSpaces: boolean): { end: number } | null {
  let j = i;
  while (j < text.length && !isSep(text[j]) && !isQuote(text[j]) && (allowSpaces || !isSpace(text[j]))) j++;
  let end = j;
  while (allowSpaces && end > i && isSpace(text[end - 1])) end--;
  if (end === i) return null;
  return { end };
}

function schemeBefore(text: string, slash: number): string {
  if (text[slash - 1] !== ":") return "";
  let j = slash - 2;
  while (j >= 0 && /[A-Za-z0-9+.-]/.test(text[j] ?? "")) j--;
  const scheme = text.slice(j + 1, slash - 1);
  return /^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme) ? scheme.toLowerCase() : "";
}

function toPath(span: string): InputPath | null {
  if (!span) return null;
  const { name, extension } = fileParts(span);
  return { path: span, name, extension };
}

function fileParts(span: string): { name: string; extension: string } {
  const trimmed = span.replace(/[\\/]+$/u, "");
  const parts = trimmed.split(/[\\/]/u).filter((part) => part.length > 0);
  const name = parts[parts.length - 1] ?? "";
  const dot = name.lastIndexOf(".");
  return { name, extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : "" };
}

function stripTrail(span: string): string {
  return span.replace(TRAIL, "");
}

function isBoundary(text: string, i: number): boolean {
  if (i <= 0) return true;
  return /[\s("'([{]/u.test(text[i - 1] ?? "");
}

function isSep(ch: string | undefined): boolean {
  return ch === "/" || ch === "\\";
}

function isQuote(ch: string | undefined): boolean {
  return ch === '"' || ch === "'";
}

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/u.test(ch);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  const setting = await readInputContainsPath();
  if (setting?.print) {
    const text = readFileSync(0, "utf8");
    process.stdout.write(inputContainsPath(text) ? "true\n" : "false\n");
  }
}
