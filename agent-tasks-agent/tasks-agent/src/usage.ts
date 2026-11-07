import type { Ledger } from "../ledger/store.ts";
import type { RatesSnapshot } from "../ledger/rate-table.ts";
import { summarizeRuns, totalsByModel, type ModelTotals, type RunSummary } from "../ledger/runs.ts";
import { tokenize } from "./args.ts";
import { formatCount, formatMoney } from "./report.ts";

export const USAGE_HELP = `/usage
/usage --all
/usage --session
/usage <runId>
/usage --help

Prints this text and does not read the ledger.

/usage            Last run.
/usage --all      Totals per provider and model.
/usage --session  This session only.
/usage <runId>    One run by id prefix.`;

export function usageHelp(input: string): string | undefined {
  if (!tokenize(input).includes("--help")) return undefined;
  return USAGE_HELP;
}

/** `2026-10-27 08:42:20` from an ISO timestamp. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatRun(run: RunSummary): string {
  const lines = [
    `Run ${run.runId.slice(0, 8)} · ${formatTime(run.startedAt)} · ${run.origin}${run.sessionId ? ` · session ${run.sessionId.slice(0, 8)}` : ""}`,
    `  ${run.label || "(no label)"}`,
  ];
  for (const call of run.calls) {
    const parts = [
      call.origin.padEnd(7),
      `${call.provider}/${call.modelRequested}`,
      `in ${formatCount(call.input)}`,
      `cached ${formatCount(call.cacheRead)}`,
      `out ${formatCount(call.output)}${call.reasoning ? ` (reasoning ${formatCount(call.reasoning)})` : ""}`,
      `total ${formatCount(call.totalTokens)}`,
    ];
    if (call.costPi !== null) parts.push(`pi ${formatMoney(call.costPi)}`);
    if (call.durationMs !== null) parts.push(`${(call.durationMs / 1000).toFixed(2)}s`);
    lines.push(`  ${parts.join(" · ")}`);
  }
  const total = [
    "total  ",
    `in ${formatCount(run.tokens.input)}`,
    `cached ${formatCount(run.tokens.cacheRead)}`,
    `out ${formatCount(run.tokens.output)}`,
    `total ${formatCount(run.tokens.total)}`,
    `est ${formatMoney(run.costEstimated)}`,
  ];
  if (run.costPi !== null) total.push(`pi ${formatMoney(run.costPi)}`);
  if (run.unrated > 0) total.push(`${run.unrated} unrated`);
  lines.push(`  ${total.join(" · ")}`);
  return lines.join("\n");
}

export function formatRunList(runs: RunSummary[]): string {
  if (runs.length === 0) return "No runs yet. Type a message, or run /ask.";
  const lines: string[] = [];
  let estimated = 0;
  let pi = 0;
  let total = 0;
  for (const run of runs) {
    estimated += run.costEstimated ?? 0;
    pi += run.costPi ?? 0;
    total += run.tokens.total;
    lines.push(
      `${formatTime(run.startedAt)} · ${run.origin.padEnd(7)} · ${String(run.tokens.total).padStart(7)} tok · ${formatMoney(run.costEstimated).padStart(10)} · ${run.label.slice(0, 60) || "(no label)"}`,
    );
  }
  lines.push(`— ${runs.length} runs · ${formatCount(total)} tokens · est ${formatMoney(estimated)} · pi ${formatMoney(pi)}`);
  return lines.join("\n");
}

export function formatTotals(rows: ModelTotals[]): string {
  if (rows.length === 0) return "No calls yet.";
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(
      `${`${row.provider}/${row.model}`.padEnd(28)} ${String(row.calls).padStart(4)} calls · ${formatCount(row.tokens.total).padStart(9)} tok · in ${formatCount(row.tokens.input)} · cached ${formatCount(row.tokens.cacheRead)} · out ${formatCount(row.tokens.output)} · est ${formatMoney(row.costEstimated)}${row.unrated > 0 ? ` · ${row.unrated} unrated` : ""}`,
    );
  }
  const totalTokens = rows.reduce((sum, row) => sum + row.tokens.total, 0);
  const estimated = rows.reduce((sum, row) => sum + row.costEstimated, 0);
  const pi = rows.reduce((sum, row) => sum + row.costPi, 0);
  lines.push(`— ${formatCount(totalTokens)} tokens · est ${formatMoney(estimated)} · pi ${formatMoney(pi)}`);
  return lines.join("\n");
}

export interface UsageView {
  text: string;
  runs: RunSummary[];
}

/** `all` totals every call, `session` only the current session, a word is a run id prefix. */
export function usageView(
  ledger: Ledger,
  rates: RatesSnapshot,
  selector: { kind: "last" } | { kind: "all" } | { kind: "session"; sessionId: string } | { kind: "run"; prefix: string },
): UsageView {
  const runs = summarizeRuns(ledger, rates);
  if (selector.kind === "all") return { text: formatTotals(totalsByModel(runs, rates)), runs };
  if (selector.kind === "session") {
    const mine = runs.filter((run) => run.sessionId === selector.sessionId);
    return { text: formatRunList(mine), runs: mine };
  }
  if (selector.kind === "run") {
    const match = runs.filter((run) => run.runId.startsWith(selector.prefix));
    if (match.length === 1) return { text: formatRun(match[0]), runs: match };
    if (match.length > 1) return { text: formatRunList(match), runs: match };
    return { text: `No run starts with "${selector.prefix}".`, runs: [] };
  }
  const last = runs[runs.length - 1];
  return last ? { text: formatRun(last), runs: [last] } : { text: "No runs yet. Type a message, or run /ask.", runs: [] };
}
