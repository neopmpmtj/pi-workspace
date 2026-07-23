// api.mjs — Codebase Summary REST API for the Pi Node.js server.
//
// Serves the codebase-summary dashboard's JSON contract: status,
// current summary, history, and async update via pi CLI subprocess.
//
// Pattern matches backup/api.mjs — exported handleCodebaseSummaryApi is
// imported by server.mjs and routed under /codebase-summary/api/*.

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(__dirname, 'store.json');

// ── Helpers ────────────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  });
  res.end(body);
}

async function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// ── Store (simple JSON file) ───────────────────────────────────────────────

function defaultStore() {
  return { current: null, history: [], lastRun: null, running: false };
}

function readStore() {
  try {
    if (!existsSync(STORE_PATH)) return defaultStore();
    const raw = readFileSync(STORE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return defaultStore();
  }
}

function writeStore(data) {
  writeFileSync(STORE_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// ── Subprocess: start update ───────────────────────────────────────────────

// Injectable for tests
let _spawn = spawn;

function startUpdate() {
  const store = readStore();
  if (store.running) {
    return { status: 'already_running', lastRun: store.lastRun };
  }

  store.running = true;
  store.lastRun = new Date().toISOString();
  writeStore(store);

  const PI_BIN = '/home/pmpmt/.local/bin/pi';
  const NODE_BIN_DIR = '/home/pmpmt/.nvm/versions/node/v24.18.0/bin';
  const child = _spawn(PI_BIN, ['-p', 'Create a summary of this codebase'], {
    cwd: process.env.HOME || process.cwd(),
    env: { ...process.env, PATH: `${NODE_BIN_DIR}:${process.env.PATH || ''}` },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  child.on('close', (code) => {
    const s = readStore();
    s.running = false;
    s.lastRun = new Date().toISOString();

    if (code !== 0) {
      s.error = `Process exited with code ${code}. stderr: ${stderr.slice(-500)}`;
      writeStore(s);
      return;
    }

    // Try to parse stdout as JSON
    let parsed;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      // Not valid JSON — store the raw text wrapped
      parsed = { raw: stdout.trim(), error: 'Failed to parse output as JSON' };
    }

    // Push old current into history (keep max 3)
    if (s.current) {
      s.history.unshift({ timestamp: s.lastRun || new Date().toISOString(), summary: s.current });
      if (s.history.length > 3) s.history = s.history.slice(0, 3);
    }

    s.current = parsed;
    delete s.error;
    writeStore(s);
  });

  child.on('error', (err) => {
    const s = readStore();
    s.running = false;
    s.lastRun = new Date().toISOString();
    s.error = `Failed to spawn process: ${err.message}`;
    writeStore(s);
  });

  return { status: 'started', lastRun: store.lastRun };
}

export function _setSpawn(fn) { _spawn = fn; }

// ── Router ─────────────────────────────────────────────────────────────────

export async function handleCodebaseSummaryApi(req, res, url) {
  const method = req.method;
  const path = url.pathname;

  if (!path.startsWith('/codebase-summary/api/')) return false;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return true;
  }

  try {
    // ── GET routes ──
    if (method === 'GET') {
      if (path === '/codebase-summary/api/status') {
        const store = readStore();
        return json(res, {
          running: store.running,
          lastRun: store.lastRun,
          current: store.current,
          error: store.error || null,
        }), true;
      }

      if (path === '/codebase-summary/api/current') {
        const store = readStore();
        return json(res, {
          current: store.current,
          lastRun: store.lastRun,
        }), true;
      }

      if (path === '/codebase-summary/api/history') {
        const store = readStore();
        return json(res, {
          history: store.history || [],
        }), true;
      }

      return json(res, { error: 'Not found' }, 404), true;
    }

    // ── POST routes ──
    if (method === 'POST') {
      if (path === '/codebase-summary/api/update') {
        return json(res, startUpdate()), true;
      }

      return json(res, { error: 'Not found' }, 404), true;
    }

    return json(res, { error: 'Method not allowed' }, 405), true;
  } catch (e) {
    return json(res, { error: String(e?.message || e) }, 500), true;
  }
}
