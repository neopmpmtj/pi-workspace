import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentDir } from "./env.ts";
import { EFFORT_LEVELS, type EffortLevel } from "./models.ts";

/** Shown in Settings when preset-effort.json has not been saved yet. */
export const PRESET_EFFORT_UI_DEFAULT: EffortLevel = "none";

export function presetEffortPath(env: NodeJS.ProcessEnv): string {
  return path.join(agentDir(env), "preset-effort.json");
}

export async function readPresetEffort(env: NodeJS.ProcessEnv): Promise<EffortLevel | undefined> {
  let text: string;
  try {
    text = await readFile(presetEffortPath(env), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return parseEffort(text);
}

export async function writePresetEffort(env: NodeJS.ProcessEnv, effort: string): Promise<EffortLevel> {
  const selected = knownEffort(effort);
  await mkdir(agentDir(env), { recursive: true });
  await writeFile(presetEffortPath(env), `${JSON.stringify({ effort: selected }, null, 2)}\n`, "utf8");
  return selected;
}

function knownEffort(effort: string, source?: string): EffortLevel {
  const selected = effort.trim();
  if (!EFFORT_LEVELS.includes(selected as EffortLevel)) {
    const where = source ? ` in ${source}` : "";
    throw new Error(`Unknown effort "${selected}"${where}. Use ${EFFORT_LEVELS.join(", ")}.`);
  }
  return selected as EffortLevel;
}

function parseEffort(text: string): EffortLevel {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("preset-effort.json is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("preset-effort.json must be an object with an effort string.");
  }
  const effort = (parsed as Record<string, unknown>).effort;
  if (typeof effort !== "string") {
    throw new Error("preset-effort.json must be an object with an effort string.");
  }
  return knownEffort(effort, "preset-effort.json");
}
