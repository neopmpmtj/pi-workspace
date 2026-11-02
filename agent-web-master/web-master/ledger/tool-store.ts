import type { DatabaseSync } from "node:sqlite";
import type { Ledger } from "./store.ts";
import { toolCost, type CostStatus, type ToolRates } from "./tool-rates.ts";

/**
 * A tool call that spent money outside the chat loop. Kept in its own table so the chat
 * ledger's schema and version never move: `CREATE TABLE IF NOT EXISTS` is additive.
 */
export interface ToolCallRecord {
  /** The tool call id from the session entry; re-inserting the same id changes nothing. */
  callId: string;
  runId: string | null;
  sessionId: string | null;
  sessionFile: string;
  startedAt: string;
  /** `web_search`, `source_check`, `fetch_content` … */
  tool: string;
  kind: "search" | "fetch";
  /** Billable searches, summed across providers. */
  searches: number;
  urls: number;
  results: number;
  durationMs: number | null;
  /** Per-provider counts, e.g. `{"brave":2,"duckduckgo":1}`. */
  providerCounts: Record<string, number>;
  status: "ok" | "failed";
  ratesVersion: string;
}

export interface ToolCallRow extends ToolCallRecord {
  costEstimated: number;
  costStatus: CostStatus;
  unratedProviders: string[];
  unmeteredProviders: string[];
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tool_calls (
  call_id TEXT NOT NULL PRIMARY KEY,
  run_id TEXT,
  session_id TEXT,
  session_file TEXT NOT NULL,
  started_at TEXT NOT NULL,
  tool TEXT NOT NULL,
  kind TEXT NOT NULL,
  searches INTEGER NOT NULL,
  urls INTEGER NOT NULL,
  results INTEGER NOT NULL,
  duration_ms INTEGER,
  provider_counts TEXT NOT NULL,
  status TEXT NOT NULL,
  rates_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tool_calls_by_time ON tool_calls(started_at);
CREATE TABLE IF NOT EXISTS tool_files (
  path TEXT NOT NULL PRIMARY KEY,
  bytes INTEGER NOT NULL
);
`;

/** Creates the tool tables in the existing ledger database. Safe to call on every open. */
export function ensureToolTables(ledger: Ledger): void {
  ledger.db.exec(SCHEMA);
}

export function insertToolCall(ledger: Ledger, call: ToolCallRecord): boolean {
  const result = ledger.db
    .prepare(
      `INSERT OR IGNORE INTO tool_calls (
        call_id, run_id, session_id, session_file, started_at, tool, kind,
        searches, urls, results, duration_ms, provider_counts, status, rates_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      call.callId,
      call.runId,
      call.sessionId,
      call.sessionFile,
      call.startedAt,
      call.tool,
      call.kind,
      call.searches,
      call.urls,
      call.results,
      call.durationMs,
      JSON.stringify(call.providerCounts),
      call.status,
      call.ratesVersion,
    );
  return Number(result.changes) > 0;
}

/** The run that was open in this session at that moment, so a turn's total includes its search. */
export function runAt(db: DatabaseSync, sessionId: string | null, startedAt: string): string | null {
  if (!sessionId) return null;
  const row = db
    .prepare("SELECT run_id FROM runs WHERE session_id = ? AND started_at <= ? ORDER BY started_at DESC LIMIT 1")
    .get(sessionId, startedAt) as { run_id: string } | undefined;
  return row ? row.run_id : null;
}

export function toolFileOffset(db: DatabaseSync, file: string): number {
  const row = db.prepare("SELECT bytes FROM tool_files WHERE path = ?").get(file) as { bytes: number } | undefined;
  return row ? Number(row.bytes) : 0;
}

export function setToolFileOffset(db: DatabaseSync, file: string, bytes: number): void {
  db.prepare(
    "INSERT INTO tool_files (path, bytes) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET bytes = excluded.bytes",
  ).run(file, bytes);
}

/** Every tool call with its price applied, oldest first. */
export function readToolCalls(ledger: Ledger, rates: ToolRates): ToolCallRow[] {
  const rows = ledger.db.prepare("SELECT * FROM tool_calls ORDER BY started_at").all() as unknown as Array<
    Record<string, unknown>
  >;
  return rows.map((row) => {
    const providerCounts = parseCounts(row.provider_counts);
    const cost = toolCost(providerCounts, rates);
    return {
      callId: String(row.call_id),
      runId: typeof row.run_id === "string" ? row.run_id : null,
      sessionId: typeof row.session_id === "string" ? row.session_id : null,
      sessionFile: String(row.session_file),
      startedAt: String(row.started_at),
      tool: String(row.tool),
      kind: String(row.kind) === "fetch" ? "fetch" : "search",
      searches: Number(row.searches ?? 0),
      urls: Number(row.urls ?? 0),
      results: Number(row.results ?? 0),
      durationMs: typeof row.duration_ms === "number" ? row.duration_ms : null,
      providerCounts,
      status: String(row.status) === "failed" ? "failed" : "ok",
      ratesVersion: String(row.rates_version),
      costEstimated: cost.total,
      costStatus: cost.status,
      unratedProviders: cost.unrated,
      unmeteredProviders: cost.unmetered,
    } satisfies ToolCallRow;
  });
}

function parseCounts(value: unknown): Record<string, number> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [key, count] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof count === "number" && Number.isFinite(count) && count > 0) out[key] = count;
    }
    return out;
  } catch {
    return {};
  }
}
