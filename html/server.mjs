#!/usr/bin/env node
// server.mjs — Lightweight HTTP server for the Pi Dashboard
// Routes to multiple section pages and their APIs
// Usage: node server.mjs [--port 3000]

import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { handleBackupApi } from './backup/api.mjs';
import { handleVideoFinderApi } from './video-finder/api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'token-tracker', 'db', 'token_usage_tracker.db');

const { values } = parseArgs({
  options: { port: { type: 'string', default: '3000' } },
  strict: false
});
const PORT = parseInt(values.port) || 3000;

// ── Helpers ──────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function serveStatic(res, filePath) {
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  const content = readFileSync(filePath);
  // This is a localhost dashboard served over plain HTTP; caching static
  // assets here only causes stale-JS bugs after edits (the page loads but
  // the cached app.js does nothing). Force revalidation every time.
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': content.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  });
  res.end(content);
}

function queryDB(sql, params = []) {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL');
  let result;
  try {
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      result = db.prepare(sql).all(...params);
    } else {
      result = db.prepare(sql).run(...params);
    }
  } finally {
    db.close();
  }
  return result;
}

// ── Token Tracker API Routes ─────────────────────────────────────

function getDateFilter(url) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from && !to) return { turnWhere: '', convWhere: '', params: [] };

  const clauses = [];
  const params = [];
  if (from) { clauses.push('t.timestamp >= ?'); params.push(from + 'T00:00:00'); }
  if (to)   { clauses.push('t.timestamp <= ?'); params.push(to + 'T23:59:59'); }

  const turnWhere = clauses.length ? 'AND ' + clauses.join(' AND ') : '';
  const convWhere = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  return { turnWhere, convWhere, params };
}

function apiSummary(res, url) {
  const { turnWhere, params } = getDateFilter(url);
  let query;
  if (turnWhere) {
    // Only count conversations that have turns in the date range
    query = `
      SELECT
        COUNT(DISTINCT c.id)                          AS total_conversations,
        COALESCE(SUM(t.total_tokens), 0)              AS total_tokens,
        COALESCE(ROUND(SUM(t.cost), 6), 0)            AS total_cost,
        COALESCE(SUM(t.input_tokens), 0)              AS total_input_tokens,
        COALESCE(SUM(t.output_tokens), 0)             AS total_output_tokens,
        COALESCE(SUM(t.cache_hit_tokens), 0)          AS total_cache_hit_tokens,
        COALESCE(SUM(t.cache_miss_tokens), 0)         AS total_cache_miss_tokens,
        COALESCE(SUM(t.reasoning_tokens), 0)          AS total_reasoning_tokens
      FROM conversations c
      JOIN turns t ON t.conversation_id = c.id ${turnWhere}
    `;
  } else {
    query = `
      SELECT
        COUNT(DISTINCT c.id)                          AS total_conversations,
        COALESCE(SUM(t.total_tokens), 0)              AS total_tokens,
        COALESCE(ROUND(SUM(t.cost), 6), 0)            AS total_cost,
        COALESCE(SUM(t.input_tokens), 0)              AS total_input_tokens,
        COALESCE(SUM(t.output_tokens), 0)             AS total_output_tokens,
        COALESCE(SUM(t.cache_hit_tokens), 0)          AS total_cache_hit_tokens,
        COALESCE(SUM(t.cache_miss_tokens), 0)         AS total_cache_miss_tokens,
        COALESCE(SUM(t.reasoning_tokens), 0)          AS total_reasoning_tokens
      FROM conversations c
      LEFT JOIN turns t ON t.conversation_id = c.id
    `;
  }
  json(res, queryDB(query, params)[0]);
}

function apiConversations(res, url) {
  const { turnWhere, convWhere, params } = getDateFilter(url);
  // Filter conversations by turns in date range if filter is active
  let query, qparams;
  if (turnWhere) {
    query = `
      SELECT
        c.id,
        c.started_at,
        c.title,
        c.model,
        c.agent_name,
        c.total_tokens,
        c.total_cost,
        COUNT(t.id) AS turn_count
      FROM conversations c
      JOIN turns t ON t.conversation_id = c.id ${turnWhere}
      GROUP BY c.id
      ORDER BY c.started_at DESC
    `;
    qparams = params;
  } else {
    query = `
      SELECT
        c.id,
        c.started_at,
        c.title,
        c.model,
        c.agent_name,
        c.total_tokens,
        c.total_cost,
        COUNT(t.id) AS turn_count
      FROM conversations c
      LEFT JOIN turns t ON t.conversation_id = c.id
      GROUP BY c.id
      ORDER BY c.started_at DESC
    `;
    qparams = [];
  }
  json(res, queryDB(query, qparams));
}

function apiConversationTurns(res, convId) {
  const rows = queryDB(
    `SELECT * FROM turns WHERE conversation_id = ? ORDER BY turn_number ASC`,
    [convId]
  );
  json(res, rows);
}

function apiRecentTurns(res, url) {
  const limit = parseInt(url.searchParams.get('limit')) || 50;
  const rows = queryDB(`
    SELECT t.*, c.model AS conversation_model
    FROM turns t
    JOIN conversations c ON c.id = t.conversation_id
    ORDER BY t.timestamp DESC
    LIMIT ?
  `, [limit]);
  json(res, rows);
}

function apiDailyStats(res, url) {
  const { turnWhere, params } = getDateFilter(url);
  const rows = queryDB(`
    SELECT
      DATE(t.timestamp) AS day,
      COALESCE(SUM(t.input_tokens), 0)  AS input_tokens,
      COALESCE(SUM(t.output_tokens), 0) AS output_tokens,
      COALESCE(SUM(t.total_tokens), 0)  AS total_tokens,
      COALESCE(ROUND(SUM(t.cost), 6), 0) AS cost,
      COUNT(*) AS turns
    FROM turns t
    WHERE 1=1 ${turnWhere}
    GROUP BY DATE(t.timestamp)
    ORDER BY day ASC
  `, params);
  json(res, rows);
}

function apiAgentBreakdown(res, url) {
  const { turnWhere, params } = getDateFilter(url);
  const rows = queryDB(`
    SELECT
      c.agent_name,
      COUNT(DISTINCT c.id) AS conversations,
      COALESCE(SUM(t.total_tokens), 0)   AS total_tokens,
      COALESCE(SUM(t.input_tokens), 0)   AS input_tokens,
      COALESCE(SUM(t.output_tokens), 0)  AS output_tokens,
      COALESCE(SUM(t.cache_hit_tokens), 0) AS cache_hit_tokens,
      COALESCE(SUM(t.reasoning_tokens), 0) AS reasoning_tokens,
      COALESCE(ROUND(SUM(t.cost), 6), 0) AS cost,
      COUNT(t.id) AS turns
    FROM conversations c
    JOIN turns t ON t.conversation_id = c.id ${turnWhere}
    GROUP BY c.agent_name
    ORDER BY total_tokens DESC
  `, params);
  json(res, rows);
}

function apiModelBreakdown(res, url) {
  const { turnWhere, params } = getDateFilter(url);
  const rows = queryDB(`
    SELECT
      COALESCE(t.model, c.model, 'unknown') AS model,
      COALESCE(SUM(t.input_tokens), 0)   AS input_tokens,
      COALESCE(SUM(t.output_tokens), 0)  AS output_tokens,
      COALESCE(SUM(t.total_tokens), 0)   AS total_tokens,
      COALESCE(ROUND(SUM(t.cost), 6), 0) AS cost,
      COUNT(DISTINCT c.id) AS conversations
    FROM turns t
    JOIN conversations c ON c.id = t.conversation_id
    WHERE 1=1 ${turnWhere}
    GROUP BY COALESCE(t.model, c.model, 'unknown')
    ORDER BY total_tokens DESC
  `, params);
  json(res, rows);
}

// ── Config & Capabilities API ────────────────────────────────────

const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '/home/pmpmt';
const AGENT_DIR = join(HOME_DIR, '.pi', 'agent');
const SKILLS_DIR = join(AGENT_DIR, 'skills');
const EXTENSIONS_DIR = join(AGENT_DIR, 'extensions');
const CRON_JOBS_PATH = join(HOME_DIR, '.pi', 'cron', 'jobs.json');
const AGENTS_MD_PATH = join(AGENT_DIR, 'AGENTS.md');
const APPEND_SYSTEM_MD_PATH = join(HOME_DIR, '.pi', 'agents', 'APPEND_SYSTEM.md');
const SETTINGS_PATH = join(AGENT_DIR, 'settings.json');
const AUTH_PATH = join(AGENT_DIR, 'auth.json');
const MODELS_STORE_PATH = join(AGENT_DIR, 'models-store.json');

const PKG_DESCRIPTIONS = {
  'pi-web-access': 'Web search, fetch_content, librarian skill, video-finder dashboard',
  'pi-agent-browser-native': 'Browser automation via CDP — open pages, snapshots, clicks, form fills, Electron, QA presets',
  'pi-agents-pool': 'Sub-agent spawning, pool management, parallel task execution',
};

function apiConfig(res) {
  // ── Auth ──
  const auth = {};
  try {
    const raw = JSON.parse(readFileSync(AUTH_PATH, 'utf-8'));
    for (const [provider, entry] of Object.entries(raw)) {
      const keyVal = (entry && entry.key) ? String(entry.key) : '';
      if (keyVal.startsWith('$')) {
        const envVar = keyVal.slice(1);
        auth[provider] = { configured: !!process.env[envVar], type: entry.type || 'api_key', envVar };
      } else {
        auth[provider] = { configured: keyVal.length > 0, type: entry.type || 'api_key' };
      }
    }
  } catch { /* missing/invalid auth.json */ }
  // openrouter implicit via pi-web-access
  try {
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    if (settings.packages && settings.packages.some(p => p.includes('pi-web-access'))) {
      if (!auth.openrouter) auth.openrouter = { configured: true, type: 'via_package' };
    }
  } catch {}

  // ── Settings ──
  let settings = {};
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    // Build a flat warnings array from the warnings object
    let warnings = [];
    if (raw.warnings && typeof raw.warnings === 'object') {
      warnings = Object.entries(raw.warnings).filter(([,v]) => v).map(([k]) => k);
    }
    settings = {
      defaultModel: raw.defaultModel || null,
      defaultProvider: raw.defaultProvider || null,
      enabledModels: raw.enabledModels || [],
      theme: raw.theme || 'dark',
      compaction: !!(raw.compaction && raw.compaction.enabled),
      defaultThinkingLevel: raw.defaultThinkingLevel || null,
      steeringMode: raw.steeringMode || null,
      followUpMode: raw.followUpMode || null,
      httpIdleTimeoutMs: raw.httpIdleTimeoutMs || null,
      imagesAutoResize: !!(raw.images && raw.images.autoResize),
      hideThinkingBlock: !!raw.hideThinkingBlock,
      warnings,
      packages: raw.packages || [],
    };
  } catch {}

  // ── Models ──
  let models = { totalAvailable: 0, providers: [], byProvider: {}, enabledCount: (settings.enabledModels || []).length };
  try {
    const store = JSON.parse(readFileSync(MODELS_STORE_PATH, 'utf-8'));
    for (const [provider, data] of Object.entries(store)) {
      if (data && Array.isArray(data.models)) {
        models.providers.push(provider);
        models.byProvider[provider] = data.models.length;
        models.totalAvailable += data.models.length;
      }
    }
  } catch {}

  // ── Packages ──
  const packages = (settings.packages || []).map(p => {
    const name = p.startsWith('npm:') ? p.slice(4) : p;
    return {
      name,
      source: p.startsWith('npm:') ? 'npm' : (p.startsWith('git:') ? 'git' : 'custom'),
      desc: PKG_DESCRIPTIONS[name] || 'Installed Pi package',
    };
  });

  // ── Agent.md ──
  let agentMd = { path: null, lines: 0, sizeBytes: 0, role: null, specialists: [] };
  try {
    const content = readFileSync(AGENTS_MD_PATH, 'utf-8');
    const lines = content.split(/\r?\n/);
    agentMd.path = '~/.pi/agent/AGENTS.md';
    agentMd.lines = lines.length;
    agentMd.sizeBytes = Buffer.byteLength(content, 'utf-8');
    // Extract role
    const roleMatch = content.match(/You are the \*\*([^*]+)\*\*/);
    if (roleMatch) agentMd.role = roleMatch[1].trim();
    // Extract specialists
    const specSection = content.match(/### Available Specialists\n([\s\S]*?)(?:###|\n\n|$)/);
    if (specSection) {
      const specLines = specSection[1].split(/\r?\n/).filter(l => l.startsWith('-'));
      agentMd.specialists = specLines.map(l => l.replace(/^-\s+\*\*([^*]+)\*\*.*$/, '$1').trim());
    }
  } catch {}

  // ── Append System.md ──
  let appendSystemMd = { exists: false, path: null, lines: 0 };
  try {
    const content = readFileSync(APPEND_SYSTEM_MD_PATH, 'utf-8');
    appendSystemMd.exists = true;
    appendSystemMd.path = '~/.pi/agents/APPEND_SYSTEM.md';
    appendSystemMd.lines = content.split(/\r?\n/).length;
  } catch {}

  json(res, { auth, settings, models, packages, agentMd, appendSystemMd });
}

function apiCapabilities(res) {
  // ── Skills ──
  const skills = [];
  const skillDirs = [];

  // Scan ~/.pi/agent/skills/
  try {
    const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => ({ absPath: join(SKILLS_DIR, d.name), name: d.name }));
    skillDirs.push(...dirs);
  } catch {}

  // Also scan package-provided skills (e.g. pi-web-access/skills/librarian)
  try {
    const nmDir = join(AGENT_DIR, 'npm', 'node_modules');
    const pkgDirs = readdirSync(nmDir, { withFileTypes: true })
      .filter(d => d.isDirectory());
    for (const pkg of pkgDirs) {
      const pkgSkillsDir = join(nmDir, pkg.name, 'skills');
      try {
        const sDirs = readdirSync(pkgSkillsDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => ({ absPath: join(pkgSkillsDir, d.name), name: d.name }));
        skillDirs.push(...sDirs);
      } catch {}
    }
  } catch {}

  for (const d of skillDirs) {
      const skillMdPath = join(d.absPath, 'SKILL.md');
      let name = d.name;
      let description = '';
      let emoji = null;
      let version = null;
      let hasDashboard = false;
      let requires = [];
      try {
        const content = readFileSync(skillMdPath, 'utf-8');
        // Extract YAML frontmatter
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const fm = fmMatch[1];
          const nameMatch = fm.match(/^name:\s*(.+)$/m);
          if (nameMatch) name = nameMatch[1].trim();
          const descMatch = fm.match(/^description:\s*(.+)$/m);
          if (descMatch) description = descMatch[1].trim();
          const emojiMatch = fm.match(/emoji:\s*"?([^"]+)"?\s*$/m);
          if (emojiMatch) emoji = emojiMatch[1].trim();
          const verMatch = fm.match(/^version:\s*(.+)$/m);
          if (verMatch) version = verMatch[1].trim();
          // Check for requirements in metadata
          const reqSection = fm.match(/requires:\s*\n((?:\s+-.+\n?)*)/);
          if (reqSection) {
            requires = reqSection[1].split(/\r?\n/).filter(l => l.includes('- ')).map(l => l.replace(/^\s+-\s*/, '').trim());
          }
        } else {
          // No frontmatter, use first heading + paragraph
          const headingMatch = content.match(/^#\s+(.+)$/m);
          if (headingMatch) name = headingMatch[1].trim();
          const paraMatch = content.match(/^\w.+$/m);
          if (paraMatch) description = paraMatch[0].trim().substring(0, 200);
        }
      } catch {}
      // Check for web dashboard
      try {
        const dashPath = join(d.absPath, 'index.html');
        hasDashboard = existsSync(dashPath);
      } catch {}
      if (description.length > 120) description = description.substring(0, 117) + '...';
      skills.push({ name, description: description || 'No description available', emoji, version, requires, hasDashboard });
    }

  // ── Extensions ──
  const extensions = [];
  try {
    const files = readdirSync(EXTENSIONS_DIR, { withFileTypes: true })
      .filter(f => f.isFile() && (f.name.endsWith('.ts') || f.name.endsWith('.js')) && !f.name.endsWith('.d.ts'));
    for (const f of files) {
      const extPath = join(EXTENSIONS_DIR, f.name);
      let description = '';
      const commands = [];
      try {
        const content = readFileSync(extPath, 'utf-8');
        // Extract JSDoc comment
        const jsdocMatch = content.match(/\/\*\*[\s\S]*?\*\//);
        if (jsdocMatch) {
          const jsdoc = jsdocMatch[0];
          // Get first heading line
          const headingMatch = jsdoc.match(/^\s*\*\s*(.+?)(?:\s*-\s*.+)?$/m);
          if (headingMatch && !headingMatch[1].startsWith('@') && headingMatch[1].trim().length > 5) {
            // Grab the heading and the next descriptive line
            const lines = jsdoc.split(/\r?\n/);
            const descLines = [];
            let started = false;
            for (const line of lines) {
              const trimmed = line.replace(/^\s*\*\s?/, '').trim();
              if (!started && trimmed && !trimmed.startsWith('@') && trimmed.length > 3) {
                started = true;
                descLines.push(trimmed);
              } else if (started && trimmed && !trimmed.startsWith('@')) {
                descLines.push(trimmed);
              } else if (started && (!trimmed || trimmed.startsWith('@'))) {
                break;
              }
            }
            description = descLines.join(' ').substring(0, 200);
          }
        }
        // Find registered commands
        const cmdMatches = content.matchAll(/pi\.registerCommand\("([^"]+)"/g);
        for (const m of cmdMatches) commands.push('/' + m[1]);
      } catch {}
      if (!description) description = 'Pi extension';
      extensions.push({ name: f.name, description, commands, icon: null });
    }
  } catch {}

  // ── Cron jobs ──
  const cronJobs = [];
  try {
    const store = JSON.parse(readFileSync(CRON_JOBS_PATH, 'utf-8'));
    if (store.jobs && Array.isArray(store.jobs)) {
      for (const job of store.jobs) {
        let scheduleHuman = '';
        if (job.schedule) {
          if (job.schedule.kind === 'cron') {
            scheduleHuman = job.schedule.expr + (job.schedule.tz ? ' (' + job.schedule.tz + ')' : '');
          } else if (job.schedule.kind === 'every') {
            scheduleHuman = 'Every ' + (job.schedule.everyMs >= 3600000 ?
              (job.schedule.everyMs / 3600000).toFixed(1) + 'h' :
              (job.schedule.everyMs / 60000).toFixed(0) + 'm');
          } else if (job.schedule.kind === 'at') {
            scheduleHuman = 'At ' + job.schedule.at;
          }
        }
        let lastDurationHuman = null;
        if (job.state && job.state.lastDurationMs != null) {
          const s = Math.round(job.state.lastDurationMs / 1000);
          lastDurationHuman = s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
        }
        cronJobs.push({
          name: job.name,
          enabled: !!job.enabled,
          scheduleRaw: job.schedule ? job.schedule.expr || JSON.stringify(job.schedule) : '',
          scheduleHuman,
          timezone: (job.schedule && job.schedule.tz) || null,
          lastRunStatus: (job.state && job.state.lastRunStatus) || null,
          lastDurationMs: (job.state && job.state.lastDurationMs) || null,
          lastDurationHuman,
          nextRunAtMs: (job.state && job.state.nextRunAtMs) || null,
          nextRunDescription: null, // computed client-side
          description: job.description || null,
        });
      }
    }
  } catch {}

  json(res, { skills, extensions, cronJobs });
}

// ── Router ───────────────────────────────────────────────────────

function router(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // ── Home: Dashboard index ──
  if (path === '/' || path === '/index.html') {
    return serveStatic(res, join(__dirname, 'index.html'));
  }

  // ── Agent Map ──
  if (path === '/agentmap' || path === '/agentmap/') {
    return serveStatic(res, join(__dirname, 'agentmap', 'index.html'));
  }

  // ── Skills hub ──
  if (path === '/skills' || path === '/skills/') {
    return serveStatic(res, join(__dirname, 'skills', 'index.html'));
  }

  // ── Video Finder Dashboard ──
  if (path === '/video-finder' || path === '/video-finder/') {
    return serveStatic(res, join(__dirname, 'video-finder', 'index.html'));
  }
  if (path.startsWith('/video-finder/api/')) {
    return handleVideoFinderApi(req, res, url);
  }

  // ── Backup Dashboard (native Node) ──
  // Static assets + REST API. The backup *engine* (Python) is invoked as a
  // subprocess by backup/api.mjs for backups and OAuth.
  // Redirect /backup → /backup/ so relative URLs (style.css, app.js) resolve
  // against the correct base path. Without the trailing slash, browsers resolve
  // relative URLs against /, causing 404s for all static assets and JS.
  if (path === '/backup') {
    res.writeHead(301, { 'Location': '/backup/' });
    return res.end();
  }
  if (path === '/backup/') {
    return serveStatic(res, join(__dirname, 'backup', 'index.html'));
  }
  if (path.startsWith('/backup/api/')) {
    return handleBackupApi(req, res, url);
  }
  if (path.startsWith('/backup/')) {
    const subPath = path.replace('/backup/', '');
    return serveStatic(res, join(__dirname, 'backup', subPath));
  }

  // ── Token Tracker section ──
  // /token-tracker → token-tracker/index.html
  // /token-tracker/something → token-tracker/something (static file)
  if (path === '/token-tracker' || path === '/token-tracker/') {
    return serveStatic(res, join(__dirname, 'token-tracker', 'index.html'));
  }
  // Day detail page
  if (path === '/token-tracker/today' || path === '/token-tracker/today/') {
    return serveStatic(res, join(__dirname, 'token-tracker', 'today', 'index.html'));
  }
  if (path.startsWith('/token-tracker/')) {
    const subPath = path.replace('/token-tracker/', '');
    return serveStatic(res, join(__dirname, 'token-tracker', subPath));
  }

  // ── API routes (token tracker data) ──
  if (path === '/api/summary')           return apiSummary(res, url);
  if (path === '/api/conversations')     return apiConversations(res, url);
  if (path === '/api/daily')             return apiDailyStats(res, url);
  if (path === '/api/models')           return apiModelBreakdown(res, url);
  if (path === '/api/agents')           return apiAgentBreakdown(res, url);
  if (path === '/api/turns/recent') {
    return apiRecentTurns(res, url);
  }
  if (path === '/api/config')             return apiConfig(res);
  if (path === '/api/capabilities')       return apiCapabilities(res);

  // /api/conversations/:id/turns
  const convMatch = path.match(/^\/api\/conversations\/(\d+)\/turns$/);
  if (convMatch) return apiConversationTurns(res, parseInt(convMatch[1]));

  // 404
  res.writeHead(404);
  res.end('Not found');
}

// ── Auto-sync ────────────────────────────────────────────────────────────

function runSync() {
  const child = spawn(process.execPath, [join(__dirname, 'token-tracker', 'sync_sessions.mjs')], {
    stdio: 'pipe',
    cwd: join(__dirname, 'token-tracker'),
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d.toString(); });
  child.stderr.on('data', (d) => { output += d.toString(); });
  child.on('close', (code) => {
    if (code !== 0) console.error('Sync warning:', output.trim().split('\n').pop());
  });
}

// ── Start ────────────────────────────────────────────────────────

const server = createServer(router);
server.listen(PORT, () => {
  console.log(`\n  🏠 Pi Dashboard running at http://localhost:${PORT}/`);
  console.log(`  🧩 Skills          →  http://localhost:${PORT}/skills/`);
  console.log(`  🎬 Video Finder    →  http://localhost:${PORT}/video-finder/\n`);
  // Initial sync + periodic every 30s
  runSync();
  setInterval(runSync, 30_000);
});