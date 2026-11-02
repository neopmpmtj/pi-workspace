import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentDir } from "./env.ts";

export const DEFAULT_LANGUAGE = "English";
export const LANGUAGE_LIMIT_MESSAGE = "Language must be a single line of at most 80 characters.";

export function defaultLanguagePath(env: NodeJS.ProcessEnv): string {
  return path.join(agentDir(env), "default-language.json");
}

export function checkedLanguage(value: string): string {
  const language = value.trim();
  if (!language || language.length > 80 || /[\r\n]/.test(language)) {
    throw new Error(LANGUAGE_LIMIT_MESSAGE);
  }
  return language;
}

export async function readDefaultLanguage(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(defaultLanguagePath(env), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return parseLanguage(text);
}

export async function writeDefaultLanguage(env: NodeJS.ProcessEnv, value: string): Promise<string> {
  const language = checkedLanguage(value);
  await mkdir(agentDir(env), { recursive: true });
  await writeFile(defaultLanguagePath(env), `${JSON.stringify({ language }, null, 2)}\n`, "utf8");
  return language;
}

function parseLanguage(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("default-language.json is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("default-language.json must be an object with a language string.");
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "language" || typeof record.language !== "string") {
    throw new Error("default-language.json must be an object with a language string.");
  }
  return checkedLanguage(record.language);
}
