import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readInputContainsEmail } from "./global-config.ts";

/** One mailbox found in the prompt. */
export interface InputEmail {
  address: string;
  local: string;
  domain: string;
}

const LOCAL = /[A-Za-z0-9._%+-]/u;
const DOMAIN = /[A-Za-z0-9.-]/u;

/** Every accepted address, in order. An empty list means none. */
export function inputContainsEmail(text: string): InputEmail[] {
  const found: InputEmail[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "@" || isUserInfo(text, i)) continue;
    const local = readBack(text, i - 1, LOCAL);
    const domain = readForward(text, i + 1, DOMAIN).replace(/\.+$/u, "");
    if (!local || !domain || !validDomain(domain)) continue;
    found.push({ address: `${local}@${domain}`, local, domain: domain.toLowerCase() });
    i += domain.length;
  }
  return found;
}

/** Labeled lines sent with the prompt. A miss lists no address lines. */
export function inputContainsEmailLines(found: InputEmail[]): string {
  const lines = ["inputContainsEmail", `found: ${found.length > 0 ? "true" : "false"}`];
  for (const item of found) lines.push(`address: ${item.address}`, `local: ${item.local}`, `domain: ${item.domain}`);
  return lines.join("\n");
}

function isUserInfo(text: string, at: number): boolean {
  let j = at - 1;
  while (j >= 0 && !/\s/u.test(text[j] ?? "")) j--;
  return text.slice(j + 1, at).includes("://");
}

function readBack(text: string, start: number, allowed: RegExp): string {
  let j = start;
  while (j >= 0 && allowed.test(text[j] ?? "")) j--;
  return text.slice(j + 1, start + 1);
}

function readForward(text: string, start: number, allowed: RegExp): string {
  let j = start;
  while (j < text.length && allowed.test(text[j] ?? "")) j++;
  return text.slice(start, j);
}

function validDomain(domain: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/u.test(domain);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  const setting = await readInputContainsEmail();
  if (setting?.print) {
    const text = readFileSync(0, "utf8");
    process.stdout.write(inputContainsEmail(text).length > 0 ? "true\n" : "false\n");
  }
}
