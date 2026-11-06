import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readLessThanInputWords } from "./global-config.ts";

/** Labeled lines sent with the prompt. */
export function lessThanInputWordsLines(found: boolean): string {
  return `lessThanInputWords\nfound: ${found ? "true" : "false"}`;
}

/** True when the text has fewer whitespace-separated words than the given limit. */
export function lessThanInputWords(text: string, words: number): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return trimmed.split(/\s+/).length < words;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  const setting = await readLessThanInputWords();
  if (setting?.print) {
    const text = readFileSync(0, "utf8");
    process.stdout.write(lessThanInputWords(text, setting.words) ? "true\n" : "false\n");
  }
}
