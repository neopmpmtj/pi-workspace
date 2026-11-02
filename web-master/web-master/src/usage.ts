import type { Ledger } from "../ledger/store.ts";
import type { RatesSnapshot } from "../ledger/rate-table.ts";
import { summarizeRuns, totalsByModel, type ModelTotals, type RunSummary } from "../ledger/runs.ts";
import type { CostStatus } from "../ledger/tool-rates.ts";
import type { ToolCallRow } from "../ledger/tool-store.ts";
import { formatCount, formatMoney } from "./report.ts";

/** `2026-10-27 08:42:20` from an ISO timestamp. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export interface ToolLine {
  tool: string;
  startedAt: string;
  searches: number;
  urls: number;
  results: number;
  providers: Record<string, number>;
  costEstimated: number;
  costStatus: CostStatus;
  durationMs: number | null;
  status: string;
}

export function toolLine(row: ToolCallRow): ToolLine {
  return {
    tool: row.tool,
    startedAt: row.startedAt,
    searches: row.searches,
    urls: row.urls,
    results: row.results,
    providers: row.providerCounts,
    costEstimated: row.costEstimated,
    costStatus: row.costStatus,
    durationMs: row.durationMs,
    status: row.status,
  };
}

export function formatRun(run: RunSummary, tools: ToolLine[] = []): string {
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

  for (const tool of tools) {
    const providers = Object.entries(tool.providers)
      .map(([name, count]) => `${name}×${count}`)
      .join(", ");
    const parts = [
      "tool   ",
      tool.tool,
      tool.searches > 0 ? `${tool.searches} search${tool.searches === 1 ? "" : "es"}` : `${tool.urls} url${tool.urls === 1 ? "" : "s"}`,
      providers || "provider unknown",
      `${tool.results} results`,
      `est ${formatMoney(tool.costEstimated)}`,
      tool.costStatus,
    ];
    if (tool.durationMs !== null) parts.push(`${(tool.durationMs / 1000).toFixed(2)}s`);
    if (tool.status === "failed") parts.push("FAILED");
    lines.push(`  ${parts.join(" · ")}`);
  }
  if (tools.length > 0) {
    const toolsCost = tools.reduce((sum, tool) => sum + tool.costEstimated, 0);
    lines.push(`  run total · chat ${formatMoney(run.costEstimated)} + tools ${formatMoney(toolsCost)}`);
  }
  return lines.join("\n");
}

/** Searches and fetches per provider: the part of the bill the chat ledger never sees. */
export function formatTools(tools: ToolLine[]): string {
  if (tools.length === 0) return "No web tool calls yet.";
  const byProvider = new Map<string, { searches: number; urls: number; cost: number; status: CostStatus; last: string }>();
  for (const tool of tools) {
    const entries = Object.entries(tool.providers);
    for (const [provider, count] of entries) {
      const entry = byProvider.get(provider) ?? { searches: 0, urls: 0, cost: 0, status: "rated" as CostStatus, last: "" };
      entry.searches += count;
      entry.urls += tool.urls;
      entry.cost += tool.costEstimated / Math.max(entries.length, 1);
      if (tool.costStatus !== "rated") entry.status = tool.costStatus;
      if (tool.startedAt > entry.last) entry.last = tool.startedAt;
      byProvider.set(provider, entry);
    }
  }
  const lines: string[] = [];
  let total = 0;
  for (const [provider, entry] of [...byProvider.entries()].sort((a, b) => b[1].searches - a[1].searches)) {
    total += entry.cost;
    lines.push(
      `${provider.padEnd(12)} ${String(entry.searches).padStart(4)} searches · ${String(entry.urls).padStart(3)} urls · est ${formatMoney(entry.cost)}${entry.status === "rated" ? "" : ` · ${entry.status}`} · last ${formatTime(entry.last)}`,
    );
  }
  lines.push(`— ${tools.length} tool calls · est ${formatMoney(total)}`);
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
  selector:
    | { kind: "last" }
    | { kind: "all" }
    | { kind: "session"; sessionId: string }
    | { kind: "run"; prefix: string },
  tools: ToolCallRow[] = [],
): UsageView {
  /** The tool calls that belong to one run, as display lines. */
  const toolsFor = (runId: string): ToolLine[] =>
    tools.filter((tool) => tool.runId === runId).map(toolLine);
  const runs = summarizeRuns(ledger, rates);
  if (selector.kind === "all") return { text: formatTotals(totalsByModel(runs, rates)), runs };
  if (selector.kind === "session") {
    const mine = runs.filter((run) => run.sessionId === selector.sessionId);
    return { text: formatRunList(mine), runs: mine };
  }
  if (selector.kind === "run") {
    const match = runs.filter((run) => run.runId.startsWith(selector.prefix));
    if (match.length === 1) return { text: formatRun(match[0], toolsFor(match[0].runId)), runs: match };
    if (match.length > 1) return { text: formatRunList(match), runs: match };
    return { text: `No run starts with "${selector.prefix}".`, runs: [] };
  }
  const last = runs[runs.length - 1];
  if (!last) return { text: "No runs yet. Type a message, or run /ask.", runs: [] };
  return { text: formatRun(last, toolsFor(last.runId)), runs: [last] };
}
