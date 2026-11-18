/** Dollars per million tokens, the unit every provider publishes. */
export interface ModelRate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface RateEntry extends ModelRate {
  /** ISO 8601 time from which this entry applies. */
  effectiveFrom: string;
  source?: string;
}

/** Entries per model id, oldest `effectiveFrom` first. */
export type RateTable = Record<string, RateEntry[]>;

export interface RatesSnapshot {
  /** `file` is our card, `catalog` is Pi's provider catalog, `none` means nothing could be read. */
  source: "file" | "catalog" | "none";
  updatedAt: string | null;
  /** Short hash of the table. Recorded on every call so a row can be traced to a card. */
  version: string;
  models: RateTable;
  error?: string;
}

/**
 * The entry in force at `at`. This is what makes a stored row re-priceable: the
 * call keeps its timestamp, and the card supplies the entry for that moment.
 */
export function pickRate(entries: RateEntry[] | undefined, at: string): RateEntry | undefined {
  if (!entries || entries.length === 0) return undefined;
  const when = Date.parse(at);
  if (!Number.isFinite(when)) return undefined;
  let found: RateEntry | undefined;
  for (const entry of entries) {
    if (Date.parse(entry.effectiveFrom) <= when) found = entry;
    else break;
  }
  return found;
}
