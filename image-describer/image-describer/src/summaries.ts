import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const SUMMARIES_FILE = "summaries.sqlite";

export interface SummaryRow {
  imageDir: string;
  imageFile: string;
  summary: string;
  recordedAt: string;
  mode: string;
  language: string;
  model: string;
  runId: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS summaries (
  image_dir TEXT NOT NULL,
  image_file TEXT NOT NULL,
  summary TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  mode TEXT NOT NULL,
  language TEXT NOT NULL,
  model TEXT NOT NULL,
  run_id TEXT NOT NULL,
  PRIMARY KEY (image_dir, image_file)
);
`;

const SUMMARY_COLUMNS = ["recorded_at", "mode", "language", "model", "run_id"] as const;

/** The paragraph under a leading `## Summary` heading, before the next `##` section. */
export function summaryFromDescription(description: string): string | null {
  const match = description.match(/(?:^|\n)## Summary[ \t]*\r?\n+([\s\S]*?)(?=\n## |$)/);
  if (!match?.[1]) return null;
  const text = match[1].trim();
  if (!text || text === "None") return null;
  return text;
}

export function summariesPathForLog(logPath: string): string {
  return path.join(path.dirname(logPath), SUMMARIES_FILE);
}

export function openSummaries(filePath: string, readOnly = false): DatabaseSync {
  if (!readOnly) mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath, { timeout: 5000, readOnly });
  db.exec("PRAGMA busy_timeout = 5000");
  if (!readOnly) {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(SCHEMA);
    ensureSummaryColumns(db);
  }
  return db;
}

export function withSummaries<T>(filePath: string, fn: (db: DatabaseSync) => T, readOnly = false): T {
  const db = openSummaries(filePath, readOnly);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function upsertSummaries(filePath: string, rows: SummaryRow[]): void {
  if (rows.length === 0) return;
  withSummaries(filePath, (db) => {
    const insert = db.prepare(`INSERT INTO summaries (
      image_dir, image_file, summary, recorded_at, mode, language, model, run_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(image_dir, image_file) DO UPDATE SET
        summary = excluded.summary,
        recorded_at = excluded.recorded_at,
        mode = excluded.mode,
        language = excluded.language,
        model = excluded.model,
        run_id = excluded.run_id`);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        insert.run(row.imageDir, row.imageFile, row.summary, row.recordedAt, row.mode, row.language, row.model, row.runId);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
}

export function listSummaries(filePath: string): SummaryRow[] {
  return withSummaries(filePath, (db) => {
    const rows = db
      .prepare(`SELECT image_dir, image_file, summary, recorded_at, mode, language, model, run_id
        FROM summaries ORDER BY image_dir, image_file`)
      .all();
    return rows.map(summaryRow);
  });
}

function ensureSummaryColumns(db: DatabaseSync): void {
  const present = new Set(db.prepare("PRAGMA table_info(summaries)").all().map((row) => text(cell(row, "name"))));
  if (present.size === 0) return;
  for (const column of SUMMARY_COLUMNS) {
    if (!present.has(column)) db.exec(`ALTER TABLE summaries ADD COLUMN ${column} TEXT`);
  }
}

function summaryRow(row: object): SummaryRow {
  return {
    imageDir: text(cell(row, "image_dir")),
    imageFile: text(cell(row, "image_file")),
    summary: text(cell(row, "summary")),
    recordedAt: text(cell(row, "recorded_at")),
    mode: text(cell(row, "mode")),
    language: text(cell(row, "language")),
    model: text(cell(row, "model")),
    runId: text(cell(row, "run_id")),
  };
}

function cell(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
