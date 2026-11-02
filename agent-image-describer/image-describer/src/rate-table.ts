/** Dollars per million tokens. */
export interface ModelRate {
  input: number;
  output: number;
  cacheRead: number;
}

export interface RateEntry extends ModelRate {
  /** ISO 8601 time from which this rate applies. */
  effectiveFrom: string;
  source?: string;
}

/** Entries per model id, oldest `effectiveFrom` first. */
export type RateTable = Record<string, RateEntry[]>;

export interface RatesSnapshot {
  source: "file" | "built-in";
  updatedAt: string | null;
  models: RateTable;
  error?: string;
}
