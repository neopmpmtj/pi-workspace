import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultModelPath } from "../ledger/env.ts";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** The file the launcher reads: which provider and model the next launch uses. */
export interface DefaultModel {
  provider: string;
  model: string;
  effort: string;
  updatedAt: string;
}

export async function readDefaultModel(env: NodeJS.ProcessEnv = process.env): Promise<DefaultModel | null> {
  let text: string;
  try {
    text = await readFile(defaultModelPath(env), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("default-web-master-model.json is not valid JSON.");
  }
  const root = parsed as Partial<Record<keyof DefaultModel, unknown>>;
  return {
    provider: name(root.provider, "provider"),
    model: name(root.model, "model"),
    effort: effortLevel(root.effort),
    updatedAt: typeof root.updatedAt === "string" ? root.updatedAt : new Date(0).toISOString(),
  };
}

/** Validates before writing, so a bad flag never leaves a broken file behind. */
export async function writeDefaultModel(
  value: { provider: string; model: string; effort?: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<DefaultModel> {
  const next: DefaultModel = {
    provider: name(value.provider, "provider"),
    model: name(value.model, "model"),
    effort: effortLevel(value.effort),
    updatedAt: new Date().toISOString(),
  };
  const file = defaultModelPath(env);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function name(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`default-web-master-model.json ${field} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`default-web-master-model.json ${field} cannot be empty.`);
  if (trimmed.length > 100) throw new Error(`default-web-master-model.json ${field} is longer than 100 characters.`);
  if (/[\r\n]/.test(trimmed)) throw new Error(`default-web-master-model.json ${field} cannot contain a newline.`);
  return trimmed;
}

function effortLevel(value: unknown): string {
  if (value === undefined) return "low";
  if (typeof value !== "string" || !THINKING_LEVELS.includes(value as (typeof THINKING_LEVELS)[number])) {
    throw new Error(`default-web-master-model.json effort must be one of ${THINKING_LEVELS.join(", ")}.`);
  }
  return value;
}
