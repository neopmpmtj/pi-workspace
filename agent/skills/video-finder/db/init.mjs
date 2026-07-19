#!/usr/bin/env node
// init.mjs — Initialize the Video Finder SQLite database.
// Safe to run repeatedly (CREATE IF NOT EXISTS).
// Usage: node db/init.mjs

import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'video_finder.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL');

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS searches (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp             TEXT NOT NULL DEFAULT (datetime('now')),
      reference_url         TEXT,
      reference_title       TEXT,
      reference_channel     TEXT,
      reference_duration    INTEGER,
      similarity_dimension  TEXT NOT NULL DEFAULT 'auto',
      max_results           INTEGER NOT NULL DEFAULT 2,
      max_duration_minutes  INTEGER NOT NULL DEFAULT 15,
      date_filter           TEXT NOT NULL DEFAULT 'year',
      min_views             INTEGER DEFAULT 0,
      language              TEXT DEFAULT 'en',
      query_phrases         TEXT,
      results_json          TEXT,
      result_count          INTEGER DEFAULT 0,
      trigger_source        TEXT NOT NULL DEFAULT 'web-dashboard',
      duration_ms           INTEGER
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_searches_timestamp ON searches(timestamp DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_searches_dimension ON searches(similarity_dimension)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_searches_trigger ON searches(trigger_source)');

  console.log(`✅ Database initialized: ${DB_PATH}`);
} finally {
  db.close();
}