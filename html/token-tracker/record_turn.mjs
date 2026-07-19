#!/usr/bin/env node
// record_turn.mjs — Record a conversation turn with token usage
//
// Usage:
//   node record_turn.mjs \
//     --role assistant \
//     --model gpt-4 \
//     --input 1200 \
//     --output 350 \
//     [--conversation-id 1] \
//     [--cache-hit 0] \
//     [--cache-miss 0] \
//     [--cost 0.015]
//
// If --conversation-id is omitted, a new conversation is started.
// Outputs: conversation_id=<id> turn_id=<id> turn_number=<n>

import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'db', 'token_usage_tracker.db');

const { values } = parseArgs({
  options: {
    role:            { type: 'string' },
    model:           { type: 'string', default: '' },
    input:           { type: 'string', default: '0' },
    output:          { type: 'string', default: '0' },
    'cache-hit':     { type: 'string', default: '0' },
    'cache-miss':    { type: 'string', default: '0' },
    cost:            { type: 'string', default: '0' },
    'conversation-id': { type: 'string', default: '' },
  }
});

if (!values.role) {
  console.error('Error: --role is required');
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for concurrent access
db.exec('PRAGMA journal_mode=WAL');

let conversationId = values['conversation-id'] ? parseInt(values['conversation-id']) : 0;

// Start a new conversation if needed
if (!conversationId) {
  const stmt = db.prepare("INSERT INTO conversations (model) VALUES (?)");
  stmt.run(values.model);
  conversationId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
} else {
  // Validate conversation exists
  const exists = db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(conversationId);
  if (!exists) {
    console.error(`Error: conversation ${conversationId} not found`);
    process.exit(1);
  }
}

// Get next turn number
const turnNum = db.prepare(
  'SELECT COALESCE(MAX(turn_number), 0) + 1 AS n FROM turns WHERE conversation_id = ?'
).get(conversationId).n;

const inputTokens  = parseInt(values.input);
const outputTokens = parseInt(values.output);
const totalTokens  = inputTokens + outputTokens;
const cacheHit     = parseInt(values['cache-hit']);
const cacheMiss    = parseInt(values['cache-miss']);
const cost         = parseFloat(values.cost);

// Insert turn
const insert = db.prepare(`
  INSERT INTO turns
    (conversation_id, turn_number, role, model, input_tokens, output_tokens, total_tokens, cache_hit_tokens, cache_miss_tokens, cost)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
insert.run(conversationId, turnNum, values.role, values.model, inputTokens, outputTokens, totalTokens, cacheHit, cacheMiss, cost);
const turnId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

// Update conversation totals
db.prepare(`
  UPDATE conversations
    SET total_tokens = total_tokens + ?,
        total_cost   = total_cost + ?
    WHERE id = ?
`).run(totalTokens, cost, conversationId);

db.close();

console.log(`conversation_id=${conversationId} turn_id=${turnId} turn_number=${turnNum}`);