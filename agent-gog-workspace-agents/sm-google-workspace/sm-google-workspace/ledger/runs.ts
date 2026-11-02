import type { RatesSnapshot } from "./rate-table.ts";
import { readCalls, type CallRow, type Ledger } from "./store.ts";
import { estimateCost, sumTokens, type TokenTotals } from "./tokens.ts";

export interface RunSummary {
  runId: string;
  sessionId: string | null;
  startedAt: string;
  label: string;
  /** Derived from the calls, so it cannot go stale in the database. */
  origin: "command" | "chat" | "mixed";
  calls: CallRow[];
  tokens: TokenTotals;
  /** Null when no call in the run could be priced. */
  costEstimated: number | null;
  costPi: number | null;
  durationMs: number | null;
  /** Calls whose model had no rate entry at the time of the call. */
  unrated: number;
}

export interface ModelTotals {
  provider: string;
  model: string;
  calls: number;
  tokens: TokenTotals;
  costEstimated: number;
  costPi: number;
  unrated: number;
}

interface RunRow {
  run_id: string;
  session_id: string | null;
  started_at: string;
  label: string;
}

/** Every run, oldest first, with its calls priced by the card in force at call time. */
export function summarizeRuns(ledger: Ledger, rates: RatesSnapshot): RunSummary[] {
  const runs = ledger.db
    .prepare("SELECT run_id, session_id, started_at, label FROM runs ORDER BY started_at")
    .all() as unknown as RunRow[];
  const calls = readCalls(ledger);
  const byRun = new Map<string, CallRow[]>();
  for (const call of calls) {
    const list = byRun.get(call.runId);
    if (list) list.push(call);
    else byRun.set(call.runId, [call]);
  }

  const summaries: RunSummary[] = [];
  for (const run of runs) {
    const runCalls = byRun.get(run.run_id) ?? [];
    if (runCalls.length === 0) continue; // an empty run is not worth a row
    summaries.push(summarize(run, runCalls, rates));
  }

  // A call can exist without its run row only if the ledger was edited by hand.
  const known = new Set(summaries.map((summary) => summary.runId));
  for (const [runId, runCalls] of byRun) {
    if (known.has(runId)) continue;
    summaries.push(
      summarize(
        { run_id: runId, session_id: runCalls[0]?.sessionId ?? null, started_at: runCalls[0]?.startedAt ?? "", label: "(no run row)" },
        runCalls,
        rates,
      ),
    );
  }
  return summaries.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function summarize(run: RunRow, calls: CallRow[], rates: RatesSnapshot): RunSummary {
  let estimated = 0;
  let rated = 0;
  let pi = 0;
  let piKnown = false;
  let unrated = 0;
  let duration = 0;

  for (const call of calls) {
    const cost = estimateCost(tokensOfCall(call), call.modelRequested, rates, call.startedAt);
    if (cost) {
      estimated += cost.total;
      rated += 1;
    } else {
      unrated += 1;
    }
    if (call.costPi !== null) {
      pi += call.costPi;
      piKnown = true;
    }
    if (call.durationMs) duration += call.durationMs;
  }

  const origins = new Set(calls.map((call) => call.origin));
  return {
    runId: run.run_id,
    sessionId: run.session_id,
    startedAt: run.started_at,
    label: run.label,
    origin: origins.size > 1 ? "mixed" : (calls[0]?.origin ?? "chat"),
    calls,
    tokens: sumTokens(calls.map(tokensOfCall)),
    costEstimated: rated > 0 ? estimated : null,
    costPi: piKnown ? pi : null,
    durationMs: duration > 0 ? duration : null,
    unrated,
  };
}

export function tokensOfCall(call: CallRow): TokenTotals {
  return {
    input: call.input,
    output: call.output,
    cacheRead: call.cacheRead,
    cacheWrite: call.cacheWrite,
    reasoning: call.reasoning,
    total: call.totalTokens,
  };
}

/** Totals per provider and model, which is the comparison the agent exists for. */
export function totalsByModel(runs: RunSummary[], rates: RatesSnapshot): ModelTotals[] {
  const map = new Map<string, ModelTotals>();
  for (const run of runs) {
    for (const call of run.calls) {
      const key = `${call.provider}/${call.modelRequested}`;
      const entry =
        map.get(key) ??
        {
          provider: call.provider,
          model: call.modelRequested,
          calls: 0,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: null, total: 0 },
          costEstimated: 0,
          costPi: 0,
          unrated: 0,
        };
      entry.calls += 1;
      entry.tokens = sumTokens([entry.tokens, tokensOfCall(call)]);
      if (call.costPi !== null) entry.costPi += call.costPi;
      const cost = estimateCost(tokensOfCall(call), call.modelRequested, rates, call.startedAt);
      if (cost) entry.costEstimated += cost.total;
      else entry.unrated += 1;
      map.set(key, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.tokens.total - a.tokens.total);
}
