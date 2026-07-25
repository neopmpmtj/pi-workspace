// api.mjs — Backup dashboard REST API for the Node server.
//
// Serves the backup dashboard's JSON contract: settings, history (sqlite),
// log tail, and async backup/auth job orchestration. The backup *engine*
// (snapshot/gdrive/auth/db/main, Python) is invoked as a subprocess for the
// heavy lifting.
//
// Node's event loop is naturally non-blocking, so the long OAuth spawn
// (POST /api/auth) and the backup spawn (POST /api/backup) cannot stall
// other requests — no ThreadingHTTPServer or async-job lock needed.

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { hostname as osHostname } from 'node:os';

const HOME = process.env.HOME || process.env.USERPROFILE;
const BACKUP_TOOL_DIR = join(HOME, '.pi', 'apps-scripts', 'backup_laptop_tool');
const BACKUP_SRC = join(BACKUP_TOOL_DIR, 'src');
const BACKUP_VENV_PYTHON = join(BACKUP_TOOL_DIR, '.venv', 'bin', 'python3');
const BACKUP_CONFIG = join(BACKUP_SRC, 'backup_PC_tool', 'backup_config.json');
const BACKUP_LOG = join(BACKUP_SRC, 'backup_PC_tool', 'backup.log');
const BACKUP_DB = join(BACKUP_TOOL_DIR, 'backup_history.db');
const AGENT_ENV = join(HOME, '.pi', 'agent', '.env');
const BACKUP_ROOT = join(HOME, '.pi');

// Which .env keys are managed by this dashboard
const MANAGED_ENV_KEYS = new Set([
  'GDRIVE_BACKUPS_FOLDER',
  'RETENTION_COUNT',
  'USE_HOSTNAME_SUBFOLDER',
  'TOKEN_FILE',
  'GOOGLE_SERVICE_ACCOUNT_KEY',
]);

// ── Async backup job tracker ───────────────────────────────────────────────
// Single-threaded event loop → no lock needed (unlike the Python version).
let _backupJob = { running: false, result: null, startedAt: null };

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

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// ── .env file helpers ─────────────────────────────────────────────────────

function parseDotenv(path) {
  const result = {};
  if (!existsSync(path)) return result;
  const text = readFileSync(path, 'utf-8');
  for (const line of text.split(/\r?\n/)) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith('#')) continue;
    const m = stripped.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

function writeDotenv(path, vars) {
  const lines = existsSync(path) ? readFileSync(path, 'utf-8').split(/\r?\n/) : [];
  const updated = new Set();
  const out = [];
  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith('#')) { out.push(line); continue; }
    const m = stripped.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && vars[m[1]] !== undefined) {
      out.push(`${m[1]}=${vars[m[1]]}`);
      updated.add(m[1]);
    } else {
      out.push(line);
    }
  }
  for (const [k, v] of Object.entries(vars)) {
    if (!updated.has(k)) out.push(`${k}=${v}`);
  }
  writeFileSync(path, out.join('\n') + '\n', 'utf-8');
}

function parseBoolEnv(raw, def) {
  if (raw == null || String(raw).trim() === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

// ── Settings ───────────────────────────────────────────────────────────────

function loadSettings() {
  const envVars = parseDotenv(AGENT_ENV);
  let config = {};
  try {
    config = JSON.parse(readFileSync(BACKUP_CONFIG, 'utf-8'));
  } catch { /* missing/invalid config → empty */ }
  const tokenFile = envVars.TOKEN_FILE || 'gdrive_token.json';
  const saKeyPath = envVars.GOOGLE_SERVICE_ACCOUNT_KEY || '';
  const saKeyExists = saKeyPath ? existsSync(saKeyPath) : false;
  return {
    blacklist: config.blacklist || [],
    gdriveFolder: envVars.GDRIVE_BACKUPS_FOLDER || 'backups',
    retentionCount: parseInt(envVars.RETENTION_COUNT || '0') || 0,
    useHostnameSubfolder: parseBoolEnv(envVars.USE_HOSTNAME_SUBFOLDER, true),
    tokenFile,
    tokenExists: existsSync(join(BACKUP_SRC, 'backup_PC_tool', tokenFile)),
    serviceAccountKeyPath: saKeyPath,
    serviceAccountKeyExists: saKeyExists,
  };
}

function saveSettings(data) {
  if (Array.isArray(data.blacklist)) {
    let config = {};
    try { config = JSON.parse(readFileSync(BACKUP_CONFIG, 'utf-8')); } catch {}
    config.blacklist = data.blacklist;
    writeFileSync(BACKUP_CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  }
  const envUpdates = {};
  if (data.gdriveFolder !== undefined) envUpdates.GDRIVE_BACKUPS_FOLDER = String(data.gdriveFolder);
  if (data.retentionCount !== undefined) envUpdates.RETENTION_COUNT = String(data.retentionCount);
  if (data.useHostnameSubfolder !== undefined) envUpdates.USE_HOSTNAME_SUBFOLDER = data.useHostnameSubfolder ? 'true' : 'false';
  if (data.tokenFile !== undefined) envUpdates.TOKEN_FILE = String(data.tokenFile);
  if (Object.keys(envUpdates).length) writeDotenv(AGENT_ENV, envUpdates);
  return loadSettings();
}

// ── Logs ───────────────────────────────────────────────────────────────────

function getLogs(lines = 50) {
  if (!existsSync(BACKUP_LOG)) return 'No log file yet.';
  const content = readFileSync(BACKUP_LOG, 'utf-8');
  const logLines = content.trim().split(/\r?\n/);
  return logLines.slice(-lines).join('\n');
}

// ── History (SQLite, ported from db.py) ────────────────────────────────────

function dbConn() {
  const db = new DatabaseSync(BACKUP_DB);
  db.exec('PRAGMA journal_mode=WAL');
  return db;
}

function initDb() {
  if (!existsSync(BACKUP_DB)) {
    const db = dbConn();
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS backup_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          success INTEGER NOT NULL DEFAULT 0,
          exit_code INTEGER,
          archive_name TEXT,
          archive_size_bytes INTEGER,
          drive_file_id TEXT,
          duration_seconds REAL,
          trigger_source TEXT NOT NULL DEFAULT 'unknown',
          hostname TEXT NOT NULL,
          output_log TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_backup_runs_timestamp ON backup_runs(timestamp);
      `);
    } finally { db.close(); }
    return;
  }
  // Ensure schema exists (idempotent)
  const db = dbConn();
  try { db.exec('CREATE TABLE IF NOT EXISTS backup_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, success INTEGER NOT NULL DEFAULT 0, exit_code INTEGER, archive_name TEXT, archive_size_bytes INTEGER, drive_file_id TEXT, duration_seconds REAL, trigger_source TEXT NOT NULL DEFAULT \'unknown\', hostname TEXT NOT NULL, output_log TEXT)'); } finally { db.close(); }
}

function runToObj(row) {
  if (!row) return null;
  return {
    id: row.id, timestamp: row.timestamp, success: !!row.success,
    exit_code: row.exit_code, archive_name: row.archive_name,
    archive_size_bytes: row.archive_size_bytes, drive_file_id: row.drive_file_id,
    duration_seconds: row.duration_seconds, trigger_source: row.trigger_source,
    hostname: row.hostname, output_log: row.output_log,
  };
}

function getRuns(limit = 30) {
  initDb();
  const db = dbConn();
  try {
    return db.prepare('SELECT * FROM backup_runs ORDER BY timestamp DESC LIMIT ?').all(limit).map(runToObj);
  } finally { db.close(); }
}

function getRunById(id) {
  initDb();
  const db = dbConn();
  try {
    return runToObj(db.prepare('SELECT * FROM backup_runs WHERE id = ?').get(id));
  } finally { db.close(); }
}

function getStats(retentionDays = 30) {
  initDb();
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  const db = dbConn();
  try {
    const total = db.prepare('SELECT COUNT(*) AS c FROM backup_runs WHERE timestamp >= ?').get(cutoff).c;
    const succeeded = db.prepare('SELECT COUNT(*) AS c FROM backup_runs WHERE timestamp >= ? AND success = 1').get(cutoff).c;
    return { total, succeeded, failed: total - succeeded, period_days: retentionDays };
  } finally { db.close(); }
}

// ── Backup subprocess ──────────────────────────────────────────────────────

function spawnEngine({ interactive, trigger }) {
  const child = spawn(
    BACKUP_VENV_PYTHON, ['-m', 'backup_PC_tool.main'],
    {
      cwd: BACKUP_ROOT,
      env: {
        ...process.env,
        PYTHONPATH: BACKUP_SRC,
        BACKUP_INTERACTIVE: interactive ? '1' : '0',
        BROWSER: 'firefox',
        DISPLAY: process.env.DISPLAY || ':1',
        XAUTHORITY: process.env.XAUTHORITY || '/run/user/1000/gdm/Xauthority',
        ...(trigger ? { BACKUP_TRIGGER: trigger } : {}),
      },
    }
  );
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  return { child, done: new Promise((resolve) => {
    child.on('close', (code) => resolve({ success: code === 0, stdout, stderr, exitCode: code ?? -1 }));
    child.on('error', (err) => resolve({ success: false, stdout, stderr: String(err), exitCode: -1 }));
  })};
}

// Injectable for tests (so the job tracker can be exercised without a real
// subprocess). Production code uses the real spawnEngine above.
let _spawnEngine = spawnEngine;
export function _setSpawnEngine(fn) { _spawnEngine = fn; }

function startBackupAsync() {
  if (_backupJob.running) {
    return { status: 'already_running', started_at: _backupJob.startedAt };
  }
  _backupJob = { running: true, result: null, startedAt: new Date().toISOString() };
  const { child, done } = _spawnEngine({ interactive: false, trigger: 'dashboard' });
  const timeout = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 600000);
  done.then(
    (data) => {
      clearTimeout(timeout);
      _backupJob.result = data;
      _backupJob.running = false;
    },
    (err) => {
      // spawnEngine should always resolve (it handles 'close' and 'error'),
      // but guard anyway so a rejected promise can't hang the job forever.
      clearTimeout(timeout);
      _backupJob.result = { success: false, stdout: '', stderr: String(err), exitCode: -1 };
      _backupJob.running = false;
    }
  );
  return { status: 'started' };
}

function getBackupStatus() {
  // Pop the result so it is returned only once.
  if (_backupJob.result) {
    const data = _backupJob.result;
    _backupJob.result = null;
    return { status: 'complete', ...data };
  }
  if (_backupJob.running) return { status: 'running', started_at: _backupJob.startedAt };
  return { status: 'idle' };
}

async function runAuth() {
  // Standalone auth — uses auth_cli.py which only does OAuth, no backup.
  const child = spawn(
    BACKUP_VENV_PYTHON, ['-m', 'backup_PC_tool.auth_cli'],
    {
      cwd: BACKUP_ROOT,
      env: {
        ...process.env,
        PYTHONPATH: BACKUP_SRC,
        BROWSER: 'firefox',
        DISPLAY: process.env.DISPLAY || ':1',
        XAUTHORITY: process.env.XAUTHORITY || '/run/user/1000/gdm/Xauthority',
      },
    }
  );
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  const done = new Promise((resolve) => {
    child.on('close', (code) => resolve({ success: code === 0, stdout, stderr, exitCode: code ?? -1 }));
    child.on('error', (err) => resolve({ success: false, stdout, stderr: String(err), exitCode: -1 }));
  });
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({
      success: false, stdout: '', stderr: 'Auth timed out.', exitCode: -1,
    }), 300000);
  });
  try {
    const result = await Promise.race([done, timeout]);
    // Sugar: surface a human-readable error field for non-success results
    if (!result.success) {
      const errLines = (result.stderr || '').trim().split('\n').filter(l => l.trim());
      const outLines = (result.stdout || '').trim().split('\n').filter(l => l.trim());
      const lastErr = errLines[errLines.length - 1];
      const lastOut = outLines[outLines.length - 1];
      result.error = lastErr || lastOut || `Process exited with code ${result.exitCode ?? -1}`;
    }
    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Test exports ────────────────────────────────────────────────────────────
export const _internal = {
  parseDotenv, writeDotenv, parseBoolEnv,
  loadSettings, saveSettings,
  startBackupAsync, getBackupStatus, runAuth,
  _resetBackupJob: () => { _backupJob = { running: false, result: null, startedAt: null }; },
};

// ── Router ─────────────────────────────────────────────────────────────────
// Returns true if the request was handled (path was under /backup/api/).

export async function handleBackupApi(req, res, url) {
  const method = req.method;
  const path = url.pathname;

  // Only handle the API subtree; static assets are served by server.mjs.
  if (!path.startsWith('/backup/api/')) return false;

  try {
    // ── GET routes ──
    if (method === 'GET') {
      if (path === '/backup/api/settings') {
        const s = loadSettings(); s.hostname = osHostname();
        return json(res, s), true;
      }
      if (path === '/backup/api/log') {
        const lines = parseInt(url.searchParams.get('lines') || '50') || 50;
        return json(res, { log: getLogs(lines) }), true;
      }
      if (path === '/backup/api/history') {
        const idParam = url.searchParams.get('id');
        if (idParam !== null) {
          const r = getRunById(parseInt(idParam));
          if (!r) return json(res, { error: 'Run not found' }, 404), true;
          return json(res, r), true;
        }
        const limit = parseInt(url.searchParams.get('limit') || '30') || 30;
        return json(res, { runs: getRuns(limit) }), true;
      }
      if (path === '/backup/api/stats') {
        return json(res, getStats(30)), true;
      }
      if (path === '/backup/api/backup/status') {
        return json(res, getBackupStatus()), true;
      }
      return json(res, { error: 'Not found' }, 404), true;
    }

    // ── POST routes ──
    if (method === 'POST') {
      if (path === '/backup/api/settings') {
        const body = await readBody(req);
        const result = saveSettings(body);
        result.hostname = osHostname();
        return json(res, result), true;
      }
      if (path === '/backup/api/backup') {
        return json(res, startBackupAsync()), true;
      }
      if (path === '/backup/api/auth') {
        const result = await runAuth();
        return json(res, result), true;
      }
      return json(res, { error: 'Not found' }, 404), true;
    }

    return json(res, { error: 'Method not allowed' }, 405), true;
  } catch (e) {
    return json(res, { error: String(e && e.message || e) }, 500), true;
  }
}
