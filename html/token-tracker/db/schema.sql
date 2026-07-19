-- Token Spend Tracker - Database Schema
-- Stored at ~/.pi/html/db/tokens.db

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
    role            TEXT NOT NULL,          -- 'user', 'assistant', 'system', 'tool'
    model           TEXT,
    input_tokens    INTEGER DEFAULT 0,
    output_tokens   INTEGER DEFAULT 0,
    total_tokens    INTEGER DEFAULT 0,
    cache_hit_tokens   INTEGER DEFAULT 0,
    cache_miss_tokens  INTEGER DEFAULT 0,
    cost            REAL DEFAULT 0.0,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_turns_conversation ON turns(conversation_id);
CREATE INDEX IF NOT EXISTS idx_turns_timestamp   ON turns(timestamp);