import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../ledger/env.ts";
import { inputPhraseFromSection, type InputPhrase } from "./input-phrase.ts";
import { promptBuildFromSection, type PromptBuild } from "./prompt-build.ts";

/** Grouped-repo config, one level above the orchestrator submodule. */
export function globalConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(repoRoot(env), "..", "config.json");
}

/** The per-turn input phrase, beside config.json. */
export function inputPhraseConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(repoRoot(env), "..", "input-phrase-config.json");
}

/** Selectable system-prompt section, beside config.json. */
export function promptBuildConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(repoRoot(env), "..", "prompt-build-config.json");
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

/** The calendar-node hook: call the node, then deliver what it returns. */
export interface CalendarNode {
  /** Screen trace. Missing or non-boolean values stay true. */
  print: boolean;
  /** False only when mode is "dry": classify and route, run nothing. */
  route: boolean;
}

/**
 * The calendarNode section, or null when the hook stays off.
 * mode defaults to routing; "dry" prints the same trace and executes nothing.
 */
export async function readCalendarNode(env: NodeJS.ProcessEnv = process.env): Promise<CalendarNode | null> {
  const record = await readEnabledSection("calendarNode", env);
  if (!record) return null;
  return { print: record.print !== false, route: record.mode !== "dry" };
}

/** Exclusive reminder writer. off = classify only; the turn reaches the model. */
export type ReminderWriter = "store" | "tasks" | "off";

/** The reminder-node hook. Same fields and defaults as calendarNode, plus the writer. */
export interface ReminderNode extends CalendarNode {
  /**
   * store = reminders.jsonl + calendar event; tasks = gog tasks on the Reminders list;
   * off = the node routes nothing and the hook leaves the turn to the model.
   * A missing writer with writes: false is off; any other missing writer is store.
   */
  writer: ReminderWriter;
}

/**
 * The reminderNode section, or null when the hook stays off.
 * mode defaults to routing; "dry" prints the same trace and executes nothing.
 * writer is store, tasks, or off. A leftover writes: false is off; otherwise store.
 */
export async function readReminderNode(env: NodeJS.ProcessEnv = process.env): Promise<ReminderNode | null> {
  const record = await readEnabledSection("reminderNode", env);
  if (!record) return null;
  return { print: record.print !== false, route: record.mode !== "dry", writer: reminderWriterOf(record) };
}

/** store | tasks | off. An unknown writer string is off. A leftover writes: false is off. */
export function reminderWriterOf(record: Record<string, unknown>): ReminderWriter {
  const named = record.writer;
  if (named === "store" || named === "tasks" || named === "off") return named;
  if (typeof named === "string" && named.trim() !== "") return "off";
  if (record.writes === false) return "off";
  return "store";
}

/** The mode-switch hook: the deterministic layer above the JEV classifier. */
export interface ModeSwitch {
  /** Screen trace, missing or non-boolean values stay true. */
  print: boolean;
  /** "hook" answers with the CLI's own one line and no model turn; anything else uses the model. */
  answer: "model" | "hook";
}

/**
 * The modeSwitch section, or null when the hook stays off.
 * answer is "hook" only when the field says exactly that; every other value stays "model".
 */
export async function readModeSwitch(env: NodeJS.ProcessEnv = process.env): Promise<ModeSwitch | null> {
  const record = await readEnabledSection("modeSwitch", env);
  if (!record) return null;
  return { print: record.print !== false, answer: record.answer === "hook" ? "hook" : "model" };
}

/**
 * The inputPhrase section in input-phrase-config.json, or null when the hook stays off.
 * Null when that file, the section, or enabled: true is missing or unreadable.
 * An enabled section still returns a conflict when the number of on options is not exactly one.
 */
export async function readInputPhrase(env: NodeJS.ProcessEnv = process.env): Promise<InputPhrase | null> {
  const record = await readEnabledSection("inputPhrase", env, inputPhraseConfigPath(env));
  if (!record) return null;
  return inputPhraseFromSection(record);
}

/**
 * The promptBuild section in prompt-build-config.json, or null when the hook stays off.
 * Null when that file, the section, or enabled: true is missing or unreadable.
 * An enabled section still returns a conflict when the number of on options is not exactly one.
 */
export async function readPromptBuild(env: NodeJS.ProcessEnv = process.env): Promise<PromptBuild | null> {
  const record = await readEnabledSection("promptBuild", env, promptBuildConfigPath(env));
  if (!record) return null;
  return promptBuildFromSection(record);
}

async function readGate(name: string, env: NodeJS.ProcessEnv): Promise<InputGate | null> {
  const record = await readEnabledSection(name, env);
  if (!record) return null;
  return { print: record.print !== false };
}

/** Null when the file, the section, or enabled: true is missing or unreadable. */
async function readEnabledSection(name: string, env: NodeJS.ProcessEnv, file = globalConfigPath(env)): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
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
