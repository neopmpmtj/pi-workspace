import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Where a payment came from: our direct request, or a Pi chat turn. */
export type Origin = "command" | "chat";

export interface CallRecord {
  /** Stable per paid request; re-inserting the same id changes nothing. */
  callId: string;
  runId: string;
  origin: Origin;
  /** `registry` for our own request, `session` for a row read back from a session file. */
  source: "registry" | "session";
  sessionId: string | null;
  sessionFile: string | null;
  startedAt: string;
  durationMs: number | null;
  provider: string;
  modelRequested: string;
  modelReturned: string | null;
  effortRequested: string | null;
  effortEffective: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number | null;
  totalTokens: number;
  /** Pi's own figure for the same call. Null for our requests: Pi cannot see them. */
  costPi: number | null;
  ratesVersion: string;
  status: "ok" | "failed";
  failureKind: string | null;
}

export interface RunRecord {
  runId: string;
  sessionId: string | null;
  startedAt: string;
  /** First line of the input, truncated. The full text stays in the session file. */
  label: string;
  origin: Origin;
  provider: string | null;
  model: string | null;
  sessionFile?: string | null;
  /** The user-message entry this run came from, when it came from a session. */
  turnId?: string | null;
}

/** A call row as read back: tokens plus both cost estimates and the rate row used. */
export interface CallRow extends CallRecord {
  seq: number;
  costEstimated: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT NOT NULL PRIMARY KEY,
  session_id TEXT,
  session_file TEXT,
  turn_id TEXT,
  started_at TEXT NOT NULL,
  label TEXT NOT NULL,
  origin TEXT NOT NULL,
  provider TEXT,
  model TEXT
);
CREATE TABLE IF NOT EXISTS session_files (
  path TEXT NOT NULL PRIMARY KEY,
  bytes INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS calls (
  call_id TEXT NOT NULL PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  origin TEXT NOT NULL,
  source TEXT NOT NULL,
  session_id TEXT,
  session_file TEXT,
  started_at TEXT NOT NULL,
  duration_ms INTEGER,
  provider TEXT NOT NULL,
  model_requested TEXT NOT NULL,
  model_returned TEXT,
  effort_requested TEXT,
  effort_effective TEXT,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER,
  total_tokens INTEGER NOT NULL,
  cost_pi REAL,
  rates_version TEXT NOT NULL,
  status TEXT NOT NULL,
  failure_kind TEXT
);
CREATE INDEX IF NOT EXISTS calls_by_time ON calls(started_at);
CREATE INDEX IF NOT EXISTS calls_by_run ON calls(run_id, seq);
`;

/**
 * Bumped whenever the tables change. The ledger is derived data: sessions rebuild
 * the chat side, and a command row is written again the next time it runs, so a
 * version change starts from empty instead of guessing a migration.
 */
export const SCHEMA_VERSION = 1;

export interface Ledger {
  db: DatabaseSync;
  insertCall(call: CallRecord): boolean;
  upsertRun(run: RunRecord): void;
  close(): void;
}

export function openLedger(file: string): Ledger {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  const found = Number((db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined)?.user_version ?? 0);
  if (found !== SCHEMA_VERSION) {
    db.exec("DROP TABLE IF EXISTS calls; DROP TABLE IF EXISTS runs; DROP TABLE IF EXISTS session_files;");
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  } else {
    db.exec(SCHEMA);
  }
  const insert = db.prepare(`
    INSERT OR IGNORE INTO calls (
      call_id, run_id, seq, origin, source, session_id, session_file, started_at, duration_ms,
      provider, model_requested, model_returned, effort_requested, effort_effective,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
      total_tokens, cost_pi, rates_version, status, failure_kind
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const nextSeq = db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM calls WHERE run_id = ?");
  const upsert = db.prepare(`
    INSERT INTO runs (run_id, session_id, session_file, turn_id, started_at, label, origin, provider, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      session_id = COALESCE(excluded.session_id, runs.session_id),
      session_file = COALESCE(excluded.session_file, runs.session_file),
      turn_id = COALESCE(excluded.turn_id, runs.turn_id),
      label = excluded.label,
      origin = excluded.origin,
      provider = COALESCE(excluded.provider, runs.provider),
      model = COALESCE(excluded.model, runs.model)
  `);

  return {
    db,
    insertCall(call) {
      const seq = Number((nextSeq.get(call.runId) as { next: number } | undefined)?.next ?? 1);
      const result = insert.run(
        call.callId,
        call.runId,
        seq,
        call.origin,
        call.source,
        call.sessionId,
        call.sessionFile,
        call.startedAt,
        call.durationMs,
        call.provider,
        call.modelRequested,
        call.modelReturned,
        call.effortRequested,
        call.effortEffective,
        call.input,
        call.output,
        call.cacheRead,
        call.cacheWrite,
        call.reasoning,
        call.totalTokens,
        call.costPi,
        call.ratesVersion,
        call.status,
        call.failureKind,
      );
      return Number(result.changes) > 0;
    },
    upsertRun(run) {
      upsert.run(
        run.runId,
        run.sessionId,
        run.sessionFile ?? null,
        run.turnId ?? null,
        run.startedAt,
        run.label,
        run.origin,
        run.provider,
        run.model,
      );
    },
    close() {
      db.close();
    },
  };
}

/** Byte offset already ingested for a session file, so a re-read only sees new lines. */
export function fileOffset(db: DatabaseSync, file: string): number {
  const row = db.prepare("SELECT bytes FROM session_files WHERE path = ?").get(file) as { bytes: number } | undefined;
  return row ? Number(row.bytes) : 0;
}

export function setFileOffset(db: DatabaseSync, file: string, bytes: number): void {
  db.prepare(
    "INSERT INTO session_files (path, bytes) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET bytes = excluded.bytes",
  ).run(file, bytes);
}

/**
 * Attaches a command call to the session turn that produced it, when the command
 * ran as the first message of a new session and Pi therefore wrote a user entry
 * for it. Both rows belong to one run, so the duplicate run row is dropped.
 */
export function mergeRun(db: DatabaseSync, fromRunId: string, intoRunId: string): boolean {
  if (fromRunId === intoRunId) return false;
  const moved = db.prepare("UPDATE calls SET run_id = ? WHERE run_id = ?").run(intoRunId, fromRunId);
  db.prepare("DELETE FROM runs WHERE run_id = ?").run(fromRunId);
  return Number(moved.changes) > 0;
}

/** The most recent turn in a session, used to keep attaching calls after a partial read. */
export function lastTurnId(db: DatabaseSync, sessionId: string): string | null {
  const row = db
    .prepare("SELECT run_id FROM runs WHERE session_id = ? ORDER BY started_at DESC LIMIT 1")
    .get(sessionId) as { run_id: string } | undefined;
  return row ? row.run_id : null;
}

/** Every call, oldest first, with the rate row that priced it applied by the caller. */
export function readCalls(ledger: Ledger): CallRow[] {
  const rows = ledger.db.prepare("SELECT * FROM calls ORDER BY started_at, run_id, seq").all();
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      callId: text(r.call_id),
      runId: text(r.run_id),
      seq: Number(r.seq ?? 0),
      origin: text(r.origin) === "chat" ? "chat" : "command",
      source: text(r.source) === "session" ? "session" : "registry",
      sessionId: text(r.session_id) || null,
      sessionFile: text(r.session_file) || null,
      startedAt: text(r.started_at),
      durationMs: num(r.duration_ms),
      provider: text(r.provider),
      modelRequested: text(r.model_requested),
      modelReturned: text(r.model_returned) || null,
      effortRequested: text(r.effort_requested) || null,
      effortEffective: text(r.effort_effective) || null,
      input: num(r.input_tokens) ?? 0,
      output: num(r.output_tokens) ?? 0,
      cacheRead: num(r.cache_read_tokens) ?? 0,
      cacheWrite: num(r.cache_write_tokens) ?? 0,
      reasoning: num(r.reasoning_tokens),
      totalTokens: num(r.total_tokens) ?? 0,
      costPi: num(r.cost_pi),
      ratesVersion: text(r.rates_version),
      status: text(r.status) === "failed" ? "failed" : "ok",
      failureKind: text(r.failure_kind) || null,
      costEstimated: null,
    } satisfies CallRow;
  });
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
