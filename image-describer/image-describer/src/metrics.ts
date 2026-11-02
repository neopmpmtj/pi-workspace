import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DEFAULT_METRICS_FILE = path.join("logs", "metrics.sqlite");

export interface ImageCall {
  runId: string;
  recordedAt: string;
  filename: string;
  mode: string;
  effort: string;
  language: string;
  sessionId?: string;
  model: string;
  provider: string;
  status: string;
  apiDurationSeconds: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  cachedTokens: number | null;
}

export interface ChatCall {
  id: string;
  recordedAt: string;
  sessionId?: string;
  model: string;
  provider: string;
  costTotal: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS image_calls (
  run_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  session_id TEXT,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  effort TEXT,
  language TEXT,
  status TEXT NOT NULL,
  duration_seconds REAL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  reasoning_tokens INTEGER,
  cached_tokens INTEGER,
  PRIMARY KEY (run_id, filename)
);
CREATE TABLE IF NOT EXISTS chat_calls (
  id TEXT NOT NULL PRIMARY KEY,
  recorded_at TEXT NOT NULL,
  session_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  cost_total REAL NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER
);
`;

const CHAT_TOKEN_COLUMNS = [
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "reasoning_tokens",
] as const;

export function openMetrics(filePath: string, readOnly = false): DatabaseSync {
  if (!readOnly) mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath, { timeout: 5000, readOnly });
  db.exec("PRAGMA busy_timeout = 5000");
  if (!readOnly) {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(SCHEMA);
    ensureImageEffortColumn(db);
    ensureImageLanguageColumn(db);
    ensureChatTokenColumns(db);
  }
  return db;
}

export function withMetrics<T>(filePath: string, fn: (db: DatabaseSync) => T, readOnly = false): T {
  const db = openMetrics(filePath, readOnly);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function insertImageCalls(filePath: string, rows: ImageCall[]): void {
  if (rows.length === 0) return;
  withMetrics(filePath, (db) => {
    const insert = db.prepare(`INSERT OR IGNORE INTO image_calls (
      run_id, filename, recorded_at, session_id, model, provider, mode, effort, language, status,
      duration_seconds, input_tokens, output_tokens, total_tokens, reasoning_tokens, cached_tokens
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        insert.run(
          row.runId,
          row.filename,
          row.recordedAt,
          row.sessionId ?? null,
          row.model,
          row.provider,
          row.mode,
          row.effort,
          row.language,
          row.status,
          row.apiDurationSeconds,
          row.inputTokens,
          row.outputTokens,
          row.totalTokens,
          row.reasoningTokens,
          row.cachedTokens,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
}

export function insertChatCalls(db: DatabaseSync, rows: ChatCall[]): void {
  const insert = db.prepare(`INSERT INTO chat_calls (
    id, recorded_at, session_id, provider, model, cost_total,
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    recorded_at = excluded.recorded_at,
    session_id = excluded.session_id,
    provider = excluded.provider,
    model = excluded.model,
    cost_total = excluded.cost_total,
    input_tokens = excluded.input_tokens,
    output_tokens = excluded.output_tokens,
    cache_read_tokens = excluded.cache_read_tokens,
    cache_write_tokens = excluded.cache_write_tokens,
    reasoning_tokens = excluded.reasoning_tokens`);
  for (const row of rows) {
    insert.run(
      chatId(row),
      row.recordedAt,
      row.sessionId ?? null,
      row.provider,
      row.model,
      row.costTotal,
      row.inputTokens,
      row.outputTokens,
      row.cacheReadTokens,
      row.cacheWriteTokens,
      row.reasoningTokens,
    );
  }
}

export function readImageCalls(db: DatabaseSync): ImageCall[] {
  return db.prepare(`SELECT run_id, filename, recorded_at, session_id, model, provider, mode, effort, language, status,
      duration_seconds, input_tokens, output_tokens, total_tokens, reasoning_tokens, cached_tokens
    FROM image_calls
    ORDER BY recorded_at, run_id, filename`).all().map(imageCall);
}

export function readChatCalls(db: DatabaseSync): ChatCall[] {
  return db.prepare(`SELECT id, recorded_at, session_id, provider, model, cost_total,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens
    FROM chat_calls
    ORDER BY recorded_at, id`).all().map(chatCall);
}

export function imageCalls(filePath: string): ImageCall[] {
  return withMetrics(filePath, readImageCalls);
}

export function chatCalls(filePath: string): ChatCall[] {
  return withMetrics(filePath, readChatCalls);
}

function imageCall(row: object): ImageCall {
  const sessionId = text(cell(row, "session_id"));
  return {
    runId: text(cell(row, "run_id")),
    filename: text(cell(row, "filename")),
    recordedAt: text(cell(row, "recorded_at")),
    ...(sessionId ? { sessionId } : {}),
    model: text(cell(row, "model")),
    provider: text(cell(row, "provider")),
    mode: text(cell(row, "mode")),
    effort: text(cell(row, "effort")),
    language: text(cell(row, "language")),
    status: text(cell(row, "status")),
    apiDurationSeconds: num(cell(row, "duration_seconds")),
    inputTokens: num(cell(row, "input_tokens")),
    outputTokens: num(cell(row, "output_tokens")),
    totalTokens: num(cell(row, "total_tokens")),
    reasoningTokens: num(cell(row, "reasoning_tokens")),
    cachedTokens: num(cell(row, "cached_tokens")),
  };
}

function chatCall(row: object): ChatCall {
  const sessionId = text(cell(row, "session_id"));
  return {
    id: text(cell(row, "id")),
    recordedAt: text(cell(row, "recorded_at")),
    ...(sessionId ? { sessionId } : {}),
    provider: text(cell(row, "provider")),
    model: text(cell(row, "model")),
    costTotal: num(cell(row, "cost_total")) ?? 0,
    inputTokens: num(cell(row, "input_tokens")),
    outputTokens: num(cell(row, "output_tokens")),
    cacheReadTokens: num(cell(row, "cache_read_tokens")),
    cacheWriteTokens: num(cell(row, "cache_write_tokens")),
    reasoningTokens: num(cell(row, "reasoning_tokens")),
  };
}

function ensureImageLanguageColumn(db: DatabaseSync): void {
  const present = new Set(
    db.prepare("PRAGMA table_info(image_calls)").all().map((row) => text(cell(row, "name"))),
  );
  if (present.size === 0 || present.has("language")) return;
  db.exec("ALTER TABLE image_calls ADD COLUMN language TEXT");
}

function ensureImageEffortColumn(db: DatabaseSync): void {
  const present = new Set(
    db.prepare("PRAGMA table_info(image_calls)").all().map((row) => text(cell(row, "name"))),
  );
  if (present.size === 0 || present.has("effort")) return;
  db.exec("ALTER TABLE image_calls ADD COLUMN effort TEXT");
}

function ensureChatTokenColumns(db: DatabaseSync): void {
  const present = new Set(
    db.prepare("PRAGMA table_info(chat_calls)").all().map((row) => text(cell(row, "name"))),
  );
  if (present.size === 0) return;
  for (const column of CHAT_TOKEN_COLUMNS) {
    if (!present.has(column)) db.exec(`ALTER TABLE chat_calls ADD COLUMN ${column} INTEGER`);
  }
}

function chatId(row: ChatCall): string {
  return row.id || `${row.recordedAt}\n${row.costTotal}`;
}

function cell(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
