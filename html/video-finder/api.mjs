// api.mjs — Video Finder dashboard REST API for the Pi Node.js server.
//
// Serves the video-finder dashboard's JSON contract: config, search queue,
// live results, history (SQLite), stats, and job actions (rerun, compare, delete).
//
// Pattern matches backup/api.mjs — exported handleVideoFinderApi is imported
// by server.mjs and routed under /video-finder/api/*.

import { readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME || process.env.USERPROFILE;

// Skill paths
const SKILL_DIR = join(HOME, '.pi', 'agent', 'skills', 'video-finder');
const CONFIG_PATH = join(SKILL_DIR, 'config.json');
const DB_PATH = join(SKILL_DIR, 'db', 'video_finder.db');
const REQUESTS_PATH = join(SKILL_DIR, 'web', 'requests', 'current.json');
const RESULTS_PATH = join(SKILL_DIR, 'web', 'results', 'latest.json');
const PROGRESS_LOG = join(SKILL_DIR, 'web', 'logs', 'progress.log');
const PROCESS_SCRIPT = join(SKILL_DIR, 'scripts', 'process-request.sh');

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

function readJSON(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); }
  catch { return fallback; }
}

function writeJSON(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function dbConn() {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL');
  return db;
}

// ── Config ─────────────────────────────────────────────────────────────────

function getConfig() {
  return readJSON(CONFIG_PATH, {
    maxResults: 2, maxDurationMinutes: 15, dateFilter: 'year',
    similarityDimension: 'auto', minViews: 0, language: 'en', outputTemplate: 'detailed'
  });
}

function saveConfig(data) {
  const allowed = ['maxResults','maxDurationMinutes','dateFilter','similarityDimension','minViews','language','outputTemplate'];
  const cfg = getConfig();
  for (const key of allowed) {
    if (data[key] !== undefined) cfg[key] = data[key];
  }
  writeJSON(CONFIG_PATH, cfg);
  return cfg;
}

// ── Search queue ───────────────────────────────────────────────────────────

function queueSearch(data) {
  const request = {
    status: 'pending',
    reference: data.reference || '',
    isUrl: data.isUrl || false,
    timestamp: new Date().toISOString(),
  };
  writeJSON(REQUESTS_PATH, request);
  writeJSON(RESULTS_PATH, { status: 'processing', results: [] });
  return { status: 'queued', message: 'Run /skill:video-finder in Pi to process.' };
}

function getResults() {
  return readJSON(RESULTS_PATH, { status: 'empty', results: [] });
}

function getStatus() {
  const req = readJSON(REQUESTS_PATH, { status: 'idle' });
  const res = readJSON(RESULTS_PATH, { status: 'empty' });
  const processing = _processingJob?.running || false;
  return { request: req.status, results: res.status, processing };
}

// ── Process job (spawn Pi agent) ─────────────────────────────────────
let _processingJob = { running: false, startedAt: null };

function startProcessing() {
  if (_processingJob.running) return { status: 'already_running' };

  const req = readJSON(REQUESTS_PATH, { status: 'idle' });
  if (req.status !== 'pending') return { status: 'no_pending_request' };

  _processingJob = { running: true, startedAt: new Date().toISOString() };

  // Clear progress log
  writeFileSync(PROGRESS_LOG, `🔄 Processing started at ${new Date().toISOString()}\n`, 'utf-8');

  const child = spawn('bash', [PROCESS_SCRIPT], {
    cwd: SKILL_DIR,
    env: { ...process.env, HOME },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (d) => {
    appendFileSync(PROGRESS_LOG, d.toString(), 'utf-8');
  });
  child.stderr.on('data', (d) => {
    appendFileSync(PROGRESS_LOG, '[stderr] ' + d.toString(), 'utf-8');
  });

  child.on('close', (code) => {
    appendFileSync(PROGRESS_LOG, `\n✅ Pi agent finished (exit ${code}) at ${new Date().toISOString()}\n`, 'utf-8');
    _processingJob = { running: false, startedAt: null, exitCode: code };
  });

  child.on('error', (err) => {
    appendFileSync(PROGRESS_LOG, `\n❌ Pi agent error: ${err.message}\n`, 'utf-8');
    _processingJob = { running: false, startedAt: null, error: err.message };
  });

  return { status: 'started', started_at: _processingJob.startedAt };
}

function getProgress() {
  try {
    const content = readFileSync(PROGRESS_LOG, 'utf-8');
    return { progress: content, processing: _processingJob.running };
  } catch {
    return { progress: '', processing: false };
  }
}

// ── History (SQLite) ──────────────────────────────────────────────────────

function searchToObj(row) {
  if (!row) return null;
  return {
    id: row.id,
    timestamp: row.timestamp,
    reference_url: row.reference_url,
    reference_title: row.reference_title,
    reference_channel: row.reference_channel,
    reference_duration: row.reference_duration,
    similarity_dimension: row.similarity_dimension,
    max_results: row.max_results,
    max_duration_minutes: row.max_duration_minutes,
    date_filter: row.date_filter,
    min_views: row.min_views,
    language: row.language,
    query_phrases: row.query_phrases ? JSON.parse(row.query_phrases) : [],
    results: row.results_json ? JSON.parse(row.results_json) : [],
    result_count: row.result_count,
    trigger_source: row.trigger_source,
    duration_ms: row.duration_ms,
  };
}

function getHistory({ limit = 50, offset = 0, dimension, dateFrom, dateTo, trigger } = {}) {
  const db = dbConn();
  try {
    let sql = 'SELECT * FROM searches WHERE 1=1';
    const params = [];

    if (dimension && dimension !== 'all') {
      sql += ' AND similarity_dimension = ?';
      params.push(dimension);
    }
    if (dateFrom) {
      sql += ' AND timestamp >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ' AND timestamp <= ?';
      params.push(dateTo + 'T23:59:59');
    }
    if (trigger && trigger !== 'all') {
      sql += ' AND trigger_source = ?';
      params.push(trigger);
    }

    // Get total count
    const countRow = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as c')).get(...params);
    const total = countRow?.c || 0;

    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params).map(searchToObj);
    return { searches: rows, total, limit, offset };
  } finally {
    db.close();
  }
}

function getHistoryById(id) {
  const db = dbConn();
  try {
    return searchToObj(db.prepare('SELECT * FROM searches WHERE id = ?').get(id));
  } finally {
    db.close();
  }
}

function rerunSearch(id) {
  const job = getHistoryById(id);
  if (!job) return { error: 'Search not found' };

  const request = {
    status: 'pending',
    reference: job.reference_url || job.reference_title || '',
    isUrl: !!job.reference_url,
    timestamp: new Date().toISOString(),
    rerun_of: id,
  };
  writeJSON(REQUESTS_PATH, request);
  writeJSON(RESULTS_PATH, { status: 'processing', results: [] });
  return { status: 'queued', rerun_of: id, message: 'Run /skill:video-finder in Pi to process.' };
}

function compareSearches(id1, id2) {
  const job1 = getHistoryById(id1);
  const job2 = getHistoryById(id2);
  if (!job1 || !job2) return { error: 'One or both searches not found' };
  return {
    job1: { id: job1.id, title: job1.reference_title, results: job1.results, result_count: job1.result_count },
    job2: { id: job2.id, title: job2.reference_title, results: job2.results, result_count: job2.result_count },
  };
}

function deleteSearch(id) {
  const db = dbConn();
  try {
    const result = db.prepare('DELETE FROM searches WHERE id = ?').run(id);
    return { deleted: result.changes > 0, id };
  } finally {
    db.close();
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────

function getStats({ dateFrom, dateTo } = {}) {
  const db = dbConn();
  try {
    let where = '';
    const params = [];
    if (dateFrom) { where += ' AND timestamp >= ?'; params.push(dateFrom); }
    if (dateTo) { where += ' AND timestamp <= ?'; params.push(dateTo + 'T23:59:59'); }

    const total = db.prepare(`SELECT COUNT(*) as c FROM searches WHERE 1=1${where}`).get(...params)?.c || 0;
    const avgResults = db.prepare(`SELECT ROUND(AVG(result_count), 1) as a FROM searches WHERE 1=1${where}`).get(...params)?.a || 0;
    const topDimension = db.prepare(`SELECT similarity_dimension, COUNT(*) as c FROM searches WHERE 1=1${where} GROUP BY similarity_dimension ORDER BY c DESC LIMIT 1`).get(...params);
    const byTrigger = db.prepare(`SELECT trigger_source, COUNT(*) as c FROM searches WHERE 1=1${where} GROUP BY trigger_source ORDER BY c DESC`).all(...params);
    const thisWeek = db.prepare(`SELECT COUNT(*) as c FROM searches WHERE timestamp >= datetime('now', '-7 days')${where}`).get(...params)?.c || 0;
    const topRefChannels = db.prepare(`SELECT reference_channel, COUNT(*) as c FROM searches WHERE reference_channel IS NOT NULL${where} GROUP BY reference_channel ORDER BY c DESC LIMIT 5`).all(...params);

    return {
      total,
      avg_results_per_search: avgResults,
      top_dimension: topDimension ? { dimension: topDimension.similarity_dimension, count: topDimension.c } : null,
      by_trigger: byTrigger,
      this_week: thisWeek,
      top_reference_channels: topRefChannels,
    };
  } finally {
    db.close();
  }
}

// ── Router ─────────────────────────────────────────────────────────────────

export async function handleVideoFinderApi(req, res, url) {
  const method = req.method;
  const path = url.pathname;

  if (!path.startsWith('/video-finder/api/')) return false;

  try {
    // ── GET routes ──
    if (method === 'GET') {
      if (path === '/video-finder/api/config') {
        return json(res, getConfig()), true;
      }
      if (path === '/video-finder/api/results') {
        return json(res, getResults()), true;
      }
      if (path === '/video-finder/api/status') {
        return json(res, getStatus()), true;
      }
      if (path === '/video-finder/api/progress') {
        return json(res, getProgress()), true;
      }
      if (path === '/video-finder/api/stats') {
        const dateFrom = url.searchParams.get('dateFrom') || undefined;
        const dateTo = url.searchParams.get('dateTo') || undefined;
        return json(res, getStats({ dateFrom, dateTo })), true;
      }
      if (path === '/video-finder/api/history') {
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const dimension = url.searchParams.get('dimension') || undefined;
        const dateFrom = url.searchParams.get('dateFrom') || undefined;
        const dateTo = url.searchParams.get('dateTo') || undefined;
        const trigger = url.searchParams.get('trigger') || undefined;
        return json(res, getHistory({ limit, offset, dimension, dateFrom, dateTo, trigger })), true;
      }

      // /video-finder/api/history/:id
      const histMatch = path.match(/^\/video-finder\/api\/history\/(\d+)$/);
      if (histMatch) {
        const job = getHistoryById(parseInt(histMatch[1]));
        if (!job) return json(res, { error: 'Search not found' }, 404), true;
        return json(res, job), true;
      }

      return json(res, { error: 'Not found' }, 404), true;
    }

    // ── POST routes ──
    if (method === 'POST') {
      if (path === '/video-finder/api/config') {
        const body = await readBody(req);
        return json(res, saveConfig(body)), true;
      }
      if (path === '/video-finder/api/search') {
        const body = await readBody(req);
        return json(res, queueSearch(body)), true;
      }
      if (path === '/video-finder/api/process') {
        return json(res, startProcessing()), true;
      }

      // /video-finder/api/history/:id/rerun
      const rerunMatch = path.match(/^\/video-finder\/api\/history\/(\d+)\/rerun$/);
      if (rerunMatch) {
        return json(res, rerunSearch(parseInt(rerunMatch[1]))), true;
      }

      // /video-finder/api/history/compare
      if (path === '/video-finder/api/history/compare') {
        const body = await readBody(req);
        return json(res, compareSearches(body.id1, body.id2)), true;
      }

      return json(res, { error: 'Not found' }, 404), true;
    }

    // ── DELETE routes ──
    if (method === 'DELETE') {
      const delMatch = path.match(/^\/video-finder\/api\/history\/(\d+)$/);
      if (delMatch) {
        return json(res, deleteSearch(parseInt(delMatch[1]))), true;
      }
      return json(res, { error: 'Not found' }, 404), true;
    }

    return json(res, { error: 'Method not allowed' }, 405), true;
  } catch (e) {
    return json(res, { error: String(e?.message || e) }, 500), true;
  }
}