import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentDir } from "./env.ts";
import { isPromptMode, PROMPT_MODES, unknownModeMessage, type PromptMode, type PromptOverrides } from "./prompt.ts";

export const MAX_PROMPT_LENGTH = 4000;

export function promptOverridesPath(env: NodeJS.ProcessEnv): string {
  return path.join(agentDir(env), "prompts.json");
}

export async function readPromptOverrides(env: NodeJS.ProcessEnv): Promise<PromptOverrides> {
  let text: string;
  try {
    text = await readFile(promptOverridesPath(env), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return parseOverrides(text);
}

export async function writePromptOverride(env: NodeJS.ProcessEnv, mode: string, prompt: string): Promise<PromptOverrides> {
  const selected = knownMode(mode);
  const text = prompt.trim();
  if (!text) throw new Error("Prompt must not be empty. Reset the mode to use the built-in prompt.");
  if (text.length > MAX_PROMPT_LENGTH) throw new Error(`Prompt must be at most ${MAX_PROMPT_LENGTH} characters.`);
  const overrides = await readPromptOverrides(env);
  return save(env, { ...overrides, [selected]: text });
}

export async function clearPromptOverride(env: NodeJS.ProcessEnv, mode: string): Promise<PromptOverrides> {
  const selected = knownMode(mode);
  const { [selected]: _removed, ...rest } = await readPromptOverrides(env);
  return save(env, rest);
}

async function save(env: NodeJS.ProcessEnv, overrides: PromptOverrides): Promise<PromptOverrides> {
  const ordered = Object.fromEntries(
    PROMPT_MODES.filter((mode) => overrides[mode] !== undefined).map((mode) => [mode, overrides[mode]]),
  ) as PromptOverrides;
  await mkdir(agentDir(env), { recursive: true });
  await writeFile(promptOverridesPath(env), `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
  return ordered;
}

function knownMode(mode: string): PromptMode {
  const selected = mode.trim();
  if (!isPromptMode(selected)) {
    throw new Error(unknownModeMessage(selected));
  }
  return selected;
}

function parseOverrides(text: string): PromptOverrides {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("prompts.json is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("prompts.json must map mode names to prompt text.");
  }
  const overrides: PromptOverrides = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!isPromptMode(key)) {
      throw new Error(unknownModeMessage(key, "prompts.json"));
    }
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`prompts.json must give "${key}" a non-empty prompt string.`);
    }
    overrides[key] = value;
  }
  return overrides;
}
