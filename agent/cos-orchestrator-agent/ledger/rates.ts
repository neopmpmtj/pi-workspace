import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { modelsStorePath, rateCardPath } from "./env.ts";
import type { RateEntry, RateTable, RatesSnapshot } from "./rate-table.ts";

export const RATE_CARD_FILE = "model-rates.json";

/**
 * Our card wins when it exists, because it is the only one that can hold the
 * prices actually billed (off-peak, committed, corrected). Pi's catalog is the
 * fallback: it carries list prices for every model it knows, so an estimate is
 * always available.
 */
export async function readRates(env: NodeJS.ProcessEnv = process.env): Promise<RatesSnapshot> {
  const fromFile = await readCard(rateCardPath(env));
  if (fromFile.snapshot) return fromFile.snapshot;
  const fromCatalog = await readCatalog(modelsStorePath(env));
  if (fromCatalog) return fromCatalog;
  return {
    source: "none",
    updatedAt: null,
    version: "none",
    models: {},
    ...(fromFile.error ?? fromCatalog === null ? { error: fromFile.error ?? "No rate card and no provider catalog." } : {}),
  };
}

async function readCard(file: string): Promise<{ snapshot?: RatesSnapshot; error?: string }> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    return { error: `${RATE_CARD_FILE} could not be read: ${message(error)}` };
  }
  try {
    const parsed = parseRateCard(text);
    return { snapshot: { ...parsed, source: "file", version: versionOf(parsed.models) } };
  } catch (error) {
    // A malformed card must not stop a run; it falls back to the catalog and says why.
    return { error: message(error) };
  }
}

export function parseRateCard(text: string): { updatedAt: string; models: RateTable } {
  const root = record(JSON.parse(text) as unknown, RATE_CARD_FILE);
  if (root.schemaVersion !== 1) throw new Error(`${RATE_CARD_FILE} schemaVersion must be 1.`);
  if (root.currency !== "USD") throw new Error(`${RATE_CARD_FILE} currency must be "USD".`);
  if (root.unit !== "per_million_tokens") throw new Error(`${RATE_CARD_FILE} unit must be "per_million_tokens".`);
  const updatedAt = isoTime(root.updatedAt, "updatedAt");
  const listed = record(root.models, `${RATE_CARD_FILE} models`);
  const models: RateTable = {};
  for (const [id, value] of Object.entries(listed)) {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`${RATE_CARD_FILE} models.${id} must be a non-empty array.`);
    }
    const entries = value.map((item, index) => entry(item, `models.${id}[${index}]`));
    entries.sort((a, b) => Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom));
    for (let index = 1; index < entries.length; index++) {
      if (Date.parse(entries[index].effectiveFrom) === Date.parse(entries[index - 1].effectiveFrom)) {
        throw new Error(`${RATE_CARD_FILE} models.${id} has two entries for ${entries[index].effectiveFrom}.`);
      }
    }
    models[id] = entries;
  }
  return { updatedAt, models };
}

/** Same fields as a card entry, but undated: every catalog price applies from the epoch. */
async function readCatalog(file: string): Promise<RatesSnapshot | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return null;
  }
  const models: RateTable = {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  for (const provider of Object.values(parsed as Record<string, unknown>)) {
    const listed = (provider as { models?: unknown }).models;
    if (!Array.isArray(listed)) continue;
    for (const item of listed) {
      const model = item as { id?: unknown; cost?: Record<string, unknown> };
      if (typeof model.id !== "string" || !model.cost) continue;
      const cost = model.cost;
      const numbers: RateEntry = {
        effectiveFrom: "1970-01-01T00:00:00Z",
        input: num(cost.input) ?? 0,
        output: num(cost.output) ?? 0,
        cacheRead: num(cost.cacheRead) ?? 0,
        cacheWrite: num(cost.cacheWrite) ?? 0,
        source: "provider catalog",
      };
      models[model.id] = [numbers];
    }
  }
  if (Object.keys(models).length === 0) return null;
  return { source: "catalog", updatedAt: null, version: versionOf(models), models };
}

/** Short, stable hash so a call row can name the card that priced it. */
export function versionOf(models: RateTable): string {
  const canonical = Object.keys(models)
    .sort()
    .map((id) => [id, models[id].map((e) => [e.effectiveFrom, e.input, e.output, e.cacheRead, e.cacheWrite])])
    .flat(2)
    .join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

function entry(value: unknown, where: string): RateEntry {
  const item = record(value, `${RATE_CARD_FILE} ${where}`);
  const result: RateEntry = {
    effectiveFrom: isoTime(item.effectiveFrom, `${where}.effectiveFrom`),
    input: price(item.input, `${where}.input`),
    output: price(item.output, `${where}.output`),
    cacheRead: price(item.cacheRead, `${where}.cacheRead`),
    cacheWrite: item.cacheWrite === undefined ? 0 : price(item.cacheWrite, `${where}.cacheWrite`),
  };
  if (item.source !== undefined) {
    if (typeof item.source !== "string") throw new Error(`${RATE_CARD_FILE} ${where}.source must be a string.`);
    result.source = item.source;
  }
  return result;
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${what} must be an object.`);
  return value as Record<string, unknown>;
}

function isoTime(value: unknown, where: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${RATE_CARD_FILE} ${where} must be an ISO 8601 time.`);
  }
  return value;
}

function price(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${RATE_CARD_FILE} ${where} must be a number zero or higher.`);
  }
  return value;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
