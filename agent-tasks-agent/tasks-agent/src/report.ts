import type { TokenTotals } from "../ledger/tokens.ts";
import type { AskOutcome } from "./ask.ts";

/** Thousands separators, because six-digit token counts are unreadable without them. */
export function formatCount(value: number | null): string {
  if (value === null) return "?";
  return value.toLocaleString("en-US");
}

export function formatMoney(value: number | null): string {
  if (value === null) return "unrated";
  return `$${value >= 0.01 ? value.toFixed(4) : value.toFixed(6)}`;
}

export function formatTokens(tokens: TokenTotals | null): string {
  if (!tokens) return "no usage reported";
  const parts = [`in ${formatCount(tokens.input)}`];
  if (tokens.cacheRead > 0) parts.push(`cached ${formatCount(tokens.cacheRead)}`);
  parts.push(`out ${formatCount(tokens.output)}`);
  if (tokens.reasoning !== null && tokens.reasoning > 0) parts.push(`reasoning ${formatCount(tokens.reasoning)}`);
  parts.push(`total ${formatCount(tokens.total)}`);
  return parts.join(" · ");
}

/** One line, meant for stderr, so stdout stays just the answer. */
export function formatFooter(outcome: AskOutcome): string {
  const parts = [
    `${outcome.provider}/${outcome.modelRequested}`,
    formatTokens(outcome.tokens),
    `est ${formatMoney(outcome.costEstimated)}`,
  ];
  if (outcome.costPi !== null) parts.push(`pi ${formatMoney(outcome.costPi)}`);
  if (outcome.effortEffective) parts.push(`effort ${outcome.effortEffective}`);
  if (outcome.durationMs !== null) parts.push(`${(outcome.durationMs / 1000).toFixed(2)}s`);
  return `[tasks-agent] ${parts.join(" · ")}`;
}
