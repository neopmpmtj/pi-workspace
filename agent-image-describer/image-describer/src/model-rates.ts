import { readFile } from "node:fs/promises";
import path from "node:path";
import { agentDir } from "./env.ts";
import { MODELS } from "./models.ts";
import type { RateEntry, RateTable } from "./rate-table.ts";

export const MODEL_RATES_FILE = "model-rates.json";

/** Written by an external service. Lives beside `.env`, in the repo root. */
export function modelRatesPath(env: NodeJS.ProcessEnv): string {
  return path.join(path.dirname(agentDir(env)), MODEL_RATES_FILE);
}

/** The file's rates, or null when the file does not exist. Throws when the file is malformed. */
export async function readModelRates(env: NodeJS.ProcessEnv): Promise<{ updatedAt: string; models: RateTable } | null> {
  let text: string;
  try {
    text = await readFile(modelRatesPath(env), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return parseModelRates(text);
}

/** Validates the file. Ids that are not supported models are ignored. */
export function parseModelRates(text: string): { updatedAt: string; models: RateTable } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${MODEL_RATES_FILE} is not valid JSON.`);
  }
  const root = record(parsed, MODEL_RATES_FILE);
  if (root.schemaVersion !== 1) throw new Error(`${MODEL_RATES_FILE} schemaVersion must be 1.`);
  if (root.currency !== "USD") throw new Error(`${MODEL_RATES_FILE} currency must be "USD".`);
  if (root.unit !== "per_million_tokens") throw new Error(`${MODEL_RATES_FILE} unit must be "per_million_tokens".`);
  const updatedAt = isoTime(root.updatedAt, "updatedAt");
  const listed = record(root.models, `${MODEL_RATES_FILE} models`);
  const models: RateTable = {};
  for (const [id, value] of Object.entries(listed)) {
    if (!(id in MODELS)) continue;
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`${MODEL_RATES_FILE} models.${id} must be a non-empty array.`);
    }
    const entries = value.map((item, index) => rateEntry(item, `models.${id}[${index}]`));
    entries.sort((a, b) => Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom));
    for (let index = 1; index < entries.length; index++) {
      if (Date.parse(entries[index].effectiveFrom) === Date.parse(entries[index - 1].effectiveFrom)) {
        throw new Error(`${MODEL_RATES_FILE} models.${id} has two entries for ${entries[index].effectiveFrom}.`);
      }
    }
    models[id] = entries;
  }
  return { updatedAt, models };
}

function rateEntry(value: unknown, where: string): RateEntry {
  const item = record(value, `${MODEL_RATES_FILE} ${where}`);
  const entry: RateEntry = {
    effectiveFrom: isoTime(item.effectiveFrom, `${where}.effectiveFrom`),
    input: price(item.input, `${where}.input`),
    output: price(item.output, `${where}.output`),
    cacheRead: price(item.cacheRead, `${where}.cacheRead`),
  };
  if (item.source !== undefined) {
    if (typeof item.source !== "string") throw new Error(`${MODEL_RATES_FILE} ${where}.source must be a string.`);
    entry.source = item.source;
  }
  return entry;
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${what} must be an object.`);
  return value as Record<string, unknown>;
}

function isoTime(value: unknown, where: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${MODEL_RATES_FILE} ${where} must be an ISO 8601 time.`);
  }
  return value;
}

function price(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${MODEL_RATES_FILE} ${where} must be a number zero or higher.`);
  }
  return value;
}
