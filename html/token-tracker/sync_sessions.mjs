#!/usr/bin/env node
// sync_sessions.mjs — Parse pi session JSONL files and import token usage into the dashboard DB
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'db', 'token_usage_tracker.db');
const PI_DIR = join(__dirname, '..', '..');

// Discover all agent directories: ~/.pi/agent/sessions, ~/.pi/agent-frontend/sessions, etc.
function findAgentSessionDirs() {
  const dirs = [];
  try {
    for (const entry of readdirSync(PI_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'agent' || entry.name.startsWith('agent-')) {
        const sessionsPath = join(PI_DIR, entry.name, 'sessions');
        try {
          if (statSync(sessionsPath).isDirectory()) {
            // Derive agent name: "agent" → "main", "agent-frontend" → "frontend", etc.
            const agentName = entry.name === 'agent' ? 'main' : entry.name.replace(/^agent-/, '');
            dirs.push({ path: sessionsPath, agentName });
          }
        } catch { /* no sessions dir yet */ }
      }
    }
  } catch { /* pi dir may not exist */ }
  return dirs;
}

function getDB() {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL');
  return db;
}

// Ensure tracking table exists
function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS synced_sessions (
      session_path TEXT PRIMARY KEY,
      file_mtime   INTEGER NOT NULL,
      synced_at    TEXT NOT NULL DEFAULT (datetime('now')),
      turn_count   INTEGER DEFAULT 0
    );
  `);
}

// Parse one JSONL file, yield all messages (user / assistant / toolResult)
// Assistant messages include usage data; others have usage=null
async function* parseSession(filePath) {
  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'message') continue;
      const msg = entry.message;
      if (!msg) continue;
      // Resolve timestamp: prefer entry-level, fall back to message-level (ms epoch)
      let ts = entry.timestamp || null;
      if (!ts && msg.timestamp) {
        ts = new Date(msg.timestamp).toISOString();
      }
      yield {
        timestamp: ts,
        role: msg.role,
        model: msg.model || '',
        usage: msg.usage || null,
        provider: msg.provider || '',
      };
    } catch {
      // skip malformed lines
    }
  }
}

function findSessionFiles(dir) {
  const files = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...findSessionFiles(full));
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(full);
      }
    }
  } catch {
    // directory may not exist yet
  }
  return files;
}

async function syncAll() {
  const db = getDB();
  ensureSchema(db);

  const agentDirs = findAgentSessionDirs();
  const allFiles = [];
  for (const { path: dirPath, agentName } of agentDirs) {
    for (const f of findSessionFiles(dirPath)) {
      allFiles.push({ filePath: f, agentName });
    }
  }
  let totalImported = 0;

  for (const { filePath, agentName } of allFiles) {
    const stat = statSync(filePath);
    const mtime = Math.floor(stat.mtimeMs);

    // Check if already synced & unchanged
    const existing = db.prepare(
      'SELECT file_mtime, turn_count FROM synced_sessions WHERE session_path = ?'
    ).get(filePath);

    if (existing && existing.file_mtime === mtime) {
      // File unchanged, skip
      continue;
    }

    // If previously imported but file changed, delete old data for this session
    if (existing) {
      // Find the conversation for this session and delete its turns
      // We track via a session_path column we need to add to conversations
      const conv = db.prepare(
        "SELECT id FROM conversations WHERE session_path = ?"
      ).get(filePath);
      if (conv) {
        db.prepare("DELETE FROM turns WHERE conversation_id = ?").run(conv.id);
        db.prepare("DELETE FROM conversations WHERE id = ?").run(conv.id);
      }
      db.prepare("DELETE FROM synced_sessions WHERE session_path = ?").run(filePath);
    }

    // Count all turns and get model from first assistant turn
    let turnCount = 0;
    let model = '';
    for await (const turn of parseSession(filePath)) {
      turnCount++;
      if (!model && turn.usage && turn.model) model = turn.model;
    }

    if (turnCount === 0) {
      // Record as synced with 0 turns so we don't retry
      db.prepare(
        'INSERT OR REPLACE INTO synced_sessions (session_path, file_mtime, turn_count) VALUES (?, ?, 0)'
      ).run(filePath, mtime);
      continue;
    }

    // Create conversation
    const sessionName = basename(filePath, '.jsonl');
    const tsMatch = sessionName.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
    const startedAt = tsMatch ? tsMatch[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3') : null;

    db.prepare(`
      INSERT INTO conversations (started_at, title, model, session_path, agent_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      startedAt || new Date().toISOString(),
      sessionName.substring(0, 50),
      model || 'unknown',
      filePath,
      agentName
    );
    const convId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

    // Insert turns (all roles: user, assistant, toolResult)
    let turnNum = 0;
    const insertTurn = db.prepare(`
      INSERT INTO turns
        (conversation_id, turn_number, timestamp, role, model,
         input_tokens, output_tokens, total_tokens,
         cache_hit_tokens, cache_miss_tokens, reasoning_tokens, cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let convTotalTokens = 0;
    let convTotalCost = 0;

    for await (const turn of parseSession(filePath)) {
      turnNum++;
      const u = turn.usage;

      let inputTokens = 0, outputTokens = 0, totalTokens = 0;
      let cacheHit = 0, cacheMiss = 0, reasoningTokens = 0;
      let costTotal = 0;

      if (u) {
        inputTokens = u.input || 0;
        outputTokens = u.output || 0;
        totalTokens = u.totalTokens || (inputTokens + outputTokens);
        cacheHit = u.cacheRead || 0;
        cacheMiss = u.cacheWrite || 0;
        reasoningTokens = u.reasoning || 0;
        if (typeof u.cost === 'number') costTotal = u.cost;
        else if (u.cost && typeof u.cost.total === 'number') costTotal = u.cost.total;
        else if (u.cost && typeof u.cost === 'object') costTotal = Object.values(u.cost).reduce((a, v) => typeof v === 'number' ? a + v : a, 0);
      }

      insertTurn.run(
        convId, turnNum, turn.timestamp, turn.role, turn.model || model || 'unknown',
        inputTokens, outputTokens, totalTokens,
        cacheHit, cacheMiss, reasoningTokens,
        costTotal
      );

      convTotalTokens += totalTokens;
      convTotalCost += costTotal;
    }

    // Update conversation totals
    db.prepare(`
      UPDATE conversations
      SET total_tokens = ?, total_cost = ?
      WHERE id = ?
    `).run(convTotalTokens, convTotalCost, convId);

    // Record sync
    db.prepare(
      'INSERT OR REPLACE INTO synced_sessions (session_path, file_mtime, turn_count) VALUES (?, ?, ?)'
    ).run(filePath, mtime, turnNum);

    totalImported += turnNum;
    console.log(`  [${agentName}] Imported: ${basename(filePath)} → ${turnNum} turns, ${convTotalTokens.toLocaleString()} tokens, $${convTotalCost.toFixed(4)}`);
  }

  db.close();
  return totalImported;
}

// ── Main ─────────────────────────────────────────────────────────
const total = await syncAll();
if (total === 0) {
  console.log('  ✓ All sessions already synced. No new data to import.');
} else {
  console.log(`\n  ✓ Done. ${total.toLocaleString()} total turns imported.`);
}