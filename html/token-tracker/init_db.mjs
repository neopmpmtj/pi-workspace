#!/usr/bin/env node
// init_db.mjs — Initialize the token spend database using Node's built-in SQLite
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'db', 'token_usage_tracker.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

// Base tables (create if not exist)
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at    TEXT NOT NULL DEFAULT (datetime('now')),
      title         TEXT,
      model         TEXT,
      total_tokens  INTEGER DEFAULT 0,
      total_cost    REAL DEFAULT 0.0
  );

  CREATE TABLE IF NOT EXISTS turns (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      turn_number     INTEGER NOT NULL,
      timestamp       TEXT NOT NULL DEFAULT (datetime('now')),
      role            TEXT NOT NULL,
      model           TEXT,
      input_tokens    INTEGER DEFAULT 0,
      output_tokens   INTEGER DEFAULT 0,
      total_tokens    INTEGER DEFAULT 0,
      cache_hit_tokens   INTEGER DEFAULT 0,
      cache_miss_tokens  INTEGER DEFAULT 0,
      reasoning_tokens   INTEGER DEFAULT 0,
      cost            REAL DEFAULT 0.0,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  );

  CREATE TABLE IF NOT EXISTS synced_sessions (
      session_path TEXT PRIMARY KEY,
      file_mtime   INTEGER NOT NULL,
      synced_at    TEXT NOT NULL DEFAULT (datetime('now')),
      turn_count   INTEGER DEFAULT 0
  );
`);

// Migrations: add columns that may be missing from older databases
try { db.exec(`ALTER TABLE conversations ADD COLUMN session_path TEXT`); } catch {}
try { db.exec(`ALTER TABLE conversations ADD COLUMN agent_name TEXT NOT NULL DEFAULT 'main'`); } catch {}

// Indexes (after migrations so columns exist)
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_turns_conversation ON turns(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_turns_timestamp   ON turns(timestamp);
  CREATE INDEX IF NOT EXISTS idx_conv_agent_name   ON conversations(agent_name);
`);

db.close();
console.log(`Database initialized at ${DB_PATH}`);
