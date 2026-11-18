import { readFile } from "node:fs/promises";
import { promptsPath } from "../ledger/env.ts";

/**
 * The instruction every `/ask` run uses. Identical for all three providers on
 * purpose: a comparison that changes the prompt per provider measures nothing.
 */
export const DEFAULT_ASK_SYSTEM =
  "You are a helpful assistant. Answer the question directly and concisely. No preamble, no restating the question.";

/** `prompts.json` may override it; a missing or malformed file keeps the default. */
export async function readAskSystemPrompt(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  let text: string;
  try {
    text = await readFile(promptsPath(env), "utf8");
  } catch {
    return DEFAULT_ASK_SYSTEM;
  }
  try {
    const parsed = JSON.parse(text) as { ask?: unknown };
    if (typeof parsed.ask === "string" && parsed.ask.trim() !== "") return parsed.ask.trim();
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_ASK_SYSTEM;
}
