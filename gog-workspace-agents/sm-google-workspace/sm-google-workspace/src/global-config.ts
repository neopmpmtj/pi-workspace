import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../ledger/env.ts";

/** Grouped-repo config, one directory above this agent's repo. */
export function globalConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(repoRoot(env), "..", "config.json");
}

/** A configured word limit. Present only when the section is allowed to run. */
export interface LessThanInputWords {
  words: number;
  /** Screen output. Missing or non-boolean values stay true. */
  print: boolean;
}

/**
 * The lessThanInputWords section, or null when the check must stay off.
 * It runs only when enabled is boolean true and words is an integer of 1 or more.
 * print is false only when that field is boolean false; otherwise the answer is shown.
 * A missing file, a missing section, a missing words value, or invalid JSON stays off.
 */
export async function readLessThanInputWords(env: NodeJS.ProcessEnv = process.env): Promise<LessThanInputWords | null> {
  const record = await readEnabledSection("lessThanInputWords", env);
  if (!record) return null;
  const words = record.words;
  if (typeof words !== "number" || !Number.isInteger(words) || words < 1) return null;
  return { words, print: record.print !== false };
}

/** Screen switch for a gate that has no extra required field. */
export interface InputGate {
  print: boolean;
}

/** The inputContainsPath section, or null when that gate stays off. */
export async function readInputContainsPath(env: NodeJS.ProcessEnv = process.env): Promise<InputGate | null> {
  return readGate("inputContainsPath", env);
}

/** The inputContainsUrl section, or null when that gate stays off. */
export async function readInputContainsUrl(env: NodeJS.ProcessEnv = process.env): Promise<InputGate | null> {
  return readGate("inputContainsUrl", env);
}

/** The inputContainsEmail section, or null when that gate stays off. */
export async function readInputContainsEmail(env: NodeJS.ProcessEnv = process.env): Promise<InputGate | null> {
  return readGate("inputContainsEmail", env);
}

async function readGate(name: string, env: NodeJS.ProcessEnv): Promise<InputGate | null> {
  const record = await readEnabledSection(name, env);
  if (!record) return null;
  return { print: record.print !== false };
}

/** Null when the file, the section, or enabled: true is missing or unreadable. */
async function readEnabledSection(name: string, env: NodeJS.ProcessEnv): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await readFile(globalConfigPath(env), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const section = (parsed as Record<string, unknown>)[name];
  if (!section || typeof section !== "object" || Array.isArray(section)) return null;
  const record = section as Record<string, unknown>;
  if (record.enabled !== true) return null;
  return record;
}
