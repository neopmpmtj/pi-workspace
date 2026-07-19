#!/usr/bin/env node
// record-job.mjs — Insert a completed video-finder search into the SQLite database.
// Called by the Pi agent after a search finishes.
//
// Usage:
//   node scripts/record-job.mjs '<json-payload>'
//
// Payload format:
// {
//   "reference_url": "https://youtu.be/...",
//   "reference_title": "PI Architecture EXPLAINED",
//   "reference_channel": "Pi",
//   "reference_duration": 840,
//   "similarity_dimension": "topic",
//   "max_results": 2,
//   "max_duration_minutes": 15,
//   "date_filter": "year",
//   "min_views": 0,
//   "language": "en",
//   "query_phrases": ["site:youtube.com coding agent architecture", ...],
//   "results": [
//     { "title": "...", "channel": "...", "duration": "14:32", "url": "...", "why": "..." }
//   ],
//   "trigger_source": "web-dashboard",
//   "duration_ms": 3200
// }

import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(__dirname, '..');
const DB_PATH = join(SKILL_DIR, 'db', 'video_finder.db');

const payload = JSON.parse(process.argv[2] || '{}');

if (!payload.reference_title && !payload.reference_url) {
  console.error('Error: payload must include reference_title or reference_url');
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL');

try {
  const result = db.prepare(`
    INSERT INTO searches (
      timestamp, reference_url, reference_title, reference_channel,
      reference_duration, similarity_dimension, max_results,
      max_duration_minutes, date_filter, min_views, language,
      query_phrases, results_json, result_count, trigger_source, duration_ms
    ) VALUES (
      datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `).run(
    payload.reference_url || null,
    payload.reference_title || null,
    payload.reference_channel || null,
    payload.reference_duration || null,
    payload.similarity_dimension || 'auto',
    payload.max_results ?? 2,
    payload.max_duration_minutes ?? 15,
    payload.date_filter || 'year',
    payload.min_views ?? 0,
    payload.language || 'en',
    payload.query_phrases ? JSON.stringify(payload.query_phrases) : null,
    payload.results ? JSON.stringify(payload.results) : null,
    (payload.results || []).length,
    payload.trigger_source || 'web-dashboard',
    payload.duration_ms || null
  );

  console.log(`✅ Job recorded: id=${result.lastInsertRowid}, results=${(payload.results || []).length}`);
} finally {
  db.close();
}