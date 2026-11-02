import type { ModelRate, RateTable } from "../../src/rate-table.ts";

export type { ModelRate, RateEntry, RateTable, RatesSnapshot } from "../../src/rate-table.ts";

export type RateLookup = (model: string, recordedAt: string) => ModelRate | undefined;

/** Used when `model-rates.json` is missing or malformed. Dollars per million tokens, from models-store.json. */
export const builtInRates: RateTable = {
  "deepseek-flash": [{ effectiveFrom: "2026-01-01T00:00:00Z", input: 0.3, output: 1.2, cacheRead: 0.006 }],
  "gpt-6.1-sol": [{ effectiveFrom: "2026-01-01T00:00:00Z", input: 2, output: 10, cacheRead: 0.1 }],
  "gemini-3.8-flash": [{ effectiveFrom: "2026-01-01T00:00:00Z", input: 0.75, output: 3.75, cacheRead: 0.075 }],
};

/**
 * The rate in effect when a call was recorded. A call before the first entry uses the first entry.
 * A missing or unreadable time uses the latest entry that is not in the future.
 */
export function rateAt(table: RateTable, model: string, recordedAt: string): ModelRate | undefined {
  const entries = table[model];
  if (!entries || entries.length === 0) return undefined;
  const parsed = Date.parse(recordedAt);
  const at = Number.isFinite(parsed) ? parsed : Date.now();
  let chosen = entries[0];
  for (const entry of entries) {
    if (Date.parse(entry.effectiveFrom) <= at) chosen = entry;
  }
  return { input: chosen.input, output: chosen.output, cacheRead: chosen.cacheRead };
}

export function rateLookup(table: RateTable): RateLookup {
  return (model, recordedAt) => rateAt(table, model, recordedAt);
}
