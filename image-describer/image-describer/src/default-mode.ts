import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentDir } from "./env.ts";
import { PROMPT_MODES, unknownModeMessage, type PromptMode } from "./prompt.ts";

export function defaultModePath(env: NodeJS.ProcessEnv): string {
  return path.join(agentDir(env), "default-mode.json");
}

export function modeSwitches(active: PromptMode): Record<PromptMode, boolean> {
  return Object.fromEntries(PROMPT_MODES.map((mode) => [mode, mode === active])) as Record<PromptMode, boolean>;
}

export async function readDefaultMode(env: NodeJS.ProcessEnv): Promise<PromptMode> {
  let text: string;
  try {
    text = await readFile(defaultModePath(env), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "general";
    throw error;
  }
  return activeMode(text);
}

export async function writeDefaultMode(env: NodeJS.ProcessEnv, mode: string): Promise<PromptMode> {
  const selected = mode.trim();
  if (!PROMPT_MODES.includes(selected as PromptMode)) {
    throw new Error(unknownModeMessage(selected));
  }
  const active = selected as PromptMode;
  await mkdir(agentDir(env), { recursive: true });
  await writeFile(defaultModePath(env), `${JSON.stringify(modeSwitches(active), null, 2)}\n`, "utf8");
  return active;
}

function activeMode(text: string): PromptMode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("default-mode.json is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("default-mode.json must list each mode as true or false.");
  }
  const record = parsed as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !PROMPT_MODES.includes(key as PromptMode));
  if (unknown.length > 0) {
    throw new Error(unknownModeMessage(unknown[0], "default-mode.json"));
  }
  const active = PROMPT_MODES.filter((mode) => record[mode] === true);
  const bad = PROMPT_MODES.some((mode) => record[mode] !== undefined && typeof record[mode] !== "boolean");
  if (active.length !== 1 || bad) {
    throw new Error("default-mode.json must mark exactly one mode true and the rest false.");
  }
  return active[0];
}
