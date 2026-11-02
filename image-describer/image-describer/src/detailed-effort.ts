import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentDir } from "./env.ts";
import { EFFORT_LEVELS, type EffortLevel } from "./models.ts";

export const DEFAULT_DETAILED_EFFORT: EffortLevel = "medium";

export function detailedEffortPath(env: NodeJS.ProcessEnv): string {
  return path.join(agentDir(env), "detailed-effort.json");
}

export async function readDetailedEffort(env: NodeJS.ProcessEnv): Promise<EffortLevel> {
  let text: string;
  try {
    text = await readFile(detailedEffortPath(env), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_DETAILED_EFFORT;
    throw error;
  }
  return parseEffort(text);
}

export async function writeDetailedEffort(env: NodeJS.ProcessEnv, effort: string): Promise<EffortLevel> {
  const selected = knownEffort(effort);
  await mkdir(agentDir(env), { recursive: true });
  await writeFile(detailedEffortPath(env), `${JSON.stringify({ effort: selected }, null, 2)}\n`, "utf8");
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
    throw new Error("detailed-effort.json is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("detailed-effort.json must be an object with an effort string.");
  }
  const effort = (parsed as Record<string, unknown>).effort;
  if (typeof effort !== "string") {
    throw new Error("detailed-effort.json must be an object with an effort string.");
  }
  return knownEffort(effort, "detailed-effort.json");
}
