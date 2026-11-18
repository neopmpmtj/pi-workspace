import type { Usage } from "@earendil-works/pi-ai";
import { pickRate, type RatesSnapshot } from "./rate-table.ts";

/**
 * Token counts as the provider reported them. `input` excludes cache reads
 * (Pi's normalized usage sums input + cacheRead + output into totalTokens), and
 * `output` already includes `reasoning`.
 */
export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** A subset of output, when the provider reports a reasoning breakdown. */
  reasoning: number | null;
  total: number;
}

export function tokensOf(usage: Usage | null | undefined): TokenTotals | null {
  if (!usage) return null;
  return {
    input: count(usage.input),
    output: count(usage.output),
    cacheRead: count(usage.cacheRead),
    cacheWrite: count(usage.cacheWrite),
    reasoning: typeof usage.reasoning === "number" ? count(usage.reasoning) : null,
    total: count(usage.totalTokens),
  };
}

export function sumTokens(parts: TokenTotals[]): TokenTotals {
  const sum = (read: (part: TokenTotals) => number): number => parts.reduce((total, part) => total + read(part), 0);
  const reasoningKnown = parts.some((part) => part.reasoning !== null);
  return {
    input: sum((p) => p.input),
    output: sum((p) => p.output),
    cacheRead: sum((p) => p.cacheRead),
    cacheWrite: sum((p) => p.cacheWrite),
    reasoning: reasoningKnown ? sum((p) => p.reasoning ?? 0) : null,
    total: sum((p) => p.total),
  };
}

export interface CostBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

/**
 * Dollars for one call: tokens times the rate in force at `at`. Never stored as
 * a fact — recomputed on read, so editing the card re-prices history.
 */
export function estimateCost(
  tokens: TokenTotals,
  modelId: string,
  rates: RatesSnapshot,
  at: string,
): CostBreakdown | null {
  const rate = pickRate(rates.models[modelId], at);
  if (!rate) return null;
  const per = 1_000_000;
  const input = (tokens.input / per) * rate.input;
  const output = (tokens.output / per) * rate.output;
  const cacheRead = (tokens.cacheRead / per) * rate.cacheRead;
  const cacheWrite = (tokens.cacheWrite / per) * rate.cacheWrite;
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

function count(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
