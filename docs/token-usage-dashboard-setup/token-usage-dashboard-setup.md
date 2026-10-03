# Token Usage Dashboard — Setup & Integration Report

**Date:** 2026-07-13
**System:** Ubuntu 24.04, Node.js v24.18.0
**Location:** `~/.pi/html/`

---

## Problem

Opening `http://localhost:3000` in Firefox showed **"Unable to connect"** — the token spend dashboard was not loading. The project existed (server, database, frontend) but data was not being collected or displayed.

Two root causes:
1. **Server not running** — no process on port 3000
2. **No integration** — the session JSONL files (which contain detailed token usage from every pi turn) had no mechanism to be imported into the SQLite database

---

## Investigation

### Files discovered

The project at `~/.pi/html/` contained:

| File | Purpose |
|------|---------|
| `server.mjs` | Lightweight Node.js HTTP server using `node:sqlite` |
| `index.html` | Full dashboard UI with Chart.js (summary cards, daily chart, model doughnut, conversations table with turn drill-down) |
| `init_db.mjs` | Schema initializer for `conversations` + `turns` tables |
| `record_turn.mjs` | CLI tool to manually record a turn with token usage |
| `db/schema.sql` | Reference schema file |

### Session data found

Pi stores every conversation turn as JSONL files in `~/.pi/agent/sessions/`. Each assistant message contains a `usage` object:

```json
{
  "type": "message",
  "message": {
    "role": "assistant",
    "model": "deepseek/deepseek-v4-pro",
    "usage": {
      "input": 4449,
      "output": 151,
      "cacheRead": 0,
      "cacheWrite": 0,
      "reasoning": 13,
      "totalTokens": 4600,
      "cost": {
        "input": 0.001935,
        "output": 0.000131,
        "cacheRead": 0,
        "cacheWrite": 0,
        "total": 0.002067
      }
    }
  }
}
```

There were **16 session files** (across Jul 11–13) with hundreds of assistant turns containing complete token/cost data — but no pipeline fed this into the dashboard database. The database existed but was empty (0 conversations, 0 turns).

---

## Solution

### 1. Created `sync_sessions.mjs`

A new integration script at `~/.pi/html/token-tracker/sync_sessions.mjs` that:

- Scans all `*.jsonl` files recursively under `~/.pi/agent/sessions/`
- Parses each line, extracting only **assistant messages** (those with `usage` data)
- Tracks processed files via a `synced_sessions` table (keyed by `session_path` + `file_mtime`) to avoid re-importing unchanged files
- Creates one `conversation` per session file, then inserts each assistant message as a `turn` with full token breakdown:
  - `input_tokens`, `output_tokens`, `total_tokens`
  - `cache_hit_tokens` (from `cacheRead`), `cache_miss_tokens` (from `cacheWrite`)
  - `cost` (from `usage.cost.total`)
- Handles the active session: if the file changed since last sync (new turns added), it deletes and re-imports that conversation (since SQLite has no upsert on joined rows)
- Handles edge cases in cost format (`number` directly vs `{ total: number }` object)

### 2. Updated `server.mjs`

Added an auto-sync mechanism that spawns `sync_sessions.mjs` as a child process:

- **On startup**: runs an immediate sync
- **Every 30 seconds**: re-runs sync (same interval as the frontend auto-refresh)

This means the dashboard stays current with the active pi session in near-real-time.

### 3. Added `synced_sessions` tracking table

To `init_db.mjs` schema:

```sql
CREATE TABLE IF NOT EXISTS synced_sessions (
    session_path TEXT PRIMARY KEY,
    file_mtime   INTEGER NOT NULL,
    synced_at    TEXT NOT NULL DEFAULT (datetime('now')),
    turn_count   INTEGER DEFAULT 0
);
```

Prevents duplicate imports and enables incremental updates on changed files.

### 4. Ran initial sync

After creating the integration, ran `sync_sessions.mjs` which imported all historical data:

- **16 session files** processed
- **~330 turns** imported
- **9.4M total tokens** tracked
- **$0.63 total cost**

---

## Compartmentalization & Reorganization

After the data was flowing, restructured the codebase for multi-section extensibility:

### Before
```
~/.pi/html/
├── server.mjs
├── index.html          (token dashboard was the homepage)
├── init_db.mjs
├── record_turn.mjs
├── sync_sessions.mjs
└── db/
    └── tokens.db
```

### After
```
~/.pi/html/
├── index.html           🏠 Dashboard home — cards linking to sections
├── server.mjs           ⚙️  Multi-section HTTP server with routing
│
└── token-tracker/       📊 Token Usage Tracker (self-contained section)
    ├── index.html           Full dashboard page (moved from root)
    ├── init_db.mjs          Schema initializer
    ├── record_turn.mjs      Manual turn recorder (CLI)
    ├── sync_sessions.mjs    Session JSONL → DB importer
    ├── today/
    │   └── index.html       Day detail master-detail view (NEW)
    └── db/
        ├── token_usage_tracker.db
        └── schema.sql
```

### Key changes

| What | Before | After |
|------|--------|-------|
| **Database name** | `tokens.db` | `token_usage_tracker.db` |
| **DB location** | `html/db/` | `html/token-tracker/db/` |
| **Homepage** | Token dashboard was root | Dashboard with section cards |
| **Routing** | Flat, single page | `/` → dashboard, `/token-tracker` → tracker |
| **Navigation** | None | `← Back to Dashboard` on tracker page |
| **Extensibility** | Single-purpose | Ready for Documents, Cron Jobs, etc. sections |

### Server routing architecture

```
GET /                           → index.html (Dashboard home)
GET /token-tracker              → token-tracker/index.html
GET /token-tracker/today        → token-tracker/today/index.html (day detail)
GET /token-tracker/*            → token-tracker/* (static files)
GET /api/summary                → Token usage aggregate (incl. reasoning_tokens)
GET /api/conversations          → All conversations list
GET /api/conversations/:id/turns → Per-conversation turn detail
GET /api/daily                  → Daily token usage stats
GET /api/models                 → Per-model breakdown
GET /api/turns/recent?limit=N   → Recent turns
```

### Auto-sync flow

```
server.mjs starts
    │
    ├─ spawns sync_sessions.mjs (initial)
    │     ├─ Scans ~/.pi/agent/sessions/**/*.jsonl
    │     ├─ Skips already-synced, unchanged files
    │     ├─ Imports new/changed sessions → conversations + turns
    │     └─ Records sync state in synced_sessions table
    │
    └─ setInterval(sync, 30000) — repeats every 30s
```

---

## Results

The dashboard at `http://localhost:3000/token-tracker` now shows:

- **Summary cards**: Total tokens, total cost, conversation count, cache hit savings
- **Daily chart**: Stacked bar chart of input vs output tokens per day
- **Model breakdown**: Doughnut chart by model
- **Conversations table**: Expandable rows with per-turn token/cost drill-down
- **Auto-refresh**: Frontend polls every 30s, backend syncs every 30s

The main dashboard at `http://localhost:3000/` shows cards linking to available sections with "Coming Soon" placeholders for future additions (Documents, Cron Jobs).

---

## Enhancement: Full-Role Turn Import

**Date:** 2026-07-13 (same day, post-setup)

### Problem

The expanded conversation drill-down showed every turn labeled `ASSISTANT` — all rows were identical. Only assistant messages with token usage data were being imported, omitting user messages and tool results, which left the conversation view incomplete and confusing.

### Root cause

`sync_sessions.mjs` had a hard filter:

```javascript
if (!msg || !msg.usage) continue; // only assistant messages have usage
```

Only assistant messages carry `usage` objects (token counts, cost). User and `toolResult` messages have no usage — so they were skipped. Since the `role` column comes straight from `message.role` in the JSONL (it's dynamic, not hardcoded in the frontend), the DB stored only `"assistant"` for all 362 turns.

### Fix

Changed `parseSession()` to yield **all** message types, with `usage: null` for non-assistant messages. The import logic then inserts 0 for all token/cost fields when `usage` is null:

```javascript
// Before: filter
if (!msg || !msg.usage) continue;

// After: yield everything, null usage for non-assistant
const msg = entry.message;
if (!msg) continue;
yield {
  timestamp: ts,
  role: msg.role,
  model: msg.model || '',
  usage: msg.usage || null,  // null for user / toolResult
  provider: msg.provider || '',
};
```

Also fixed a CSS mismatch: the frontend had `.turn-role.tool` but the DB stores `"toolResult"` — changed to `.turn-role.toolResult` to match the actual role value.

### Result after re-import

After clearing and re-importing all 16 sessions:

| Role | Count | Display Color |
|------|-------|---------------|
| `toolResult` | 433 | Orange |
| `assistant` | 365 | Green |
| `user` | 72 | Blue (accent) |
| **Total** | **870** | |

The conversation drill-down now shows the full turn-by-turn flow: user prompt → assistant response → tool results, matching the actual session timeline. Only assistant turns contribute to token/cost totals.

---

## Enhancement: Date Range Filters

**Date:** 2026-07-13 (same day, post-setup)

### Problem

All data was shown at once — as sessions accumulate over days and months, the dashboard would become unwieldy with no way to zoom into specific time periods.

### Fix

Added a **filter bar** with five preset buttons (Today, Week, Month, Year, All — default: Week) and extended the API to accept date range parameters.

### API changes (`server.mjs`)

Added a `getDateFilter(url)` helper that extracts `?from=YYYY-MM-DD&to=YYYY-MM-DD` query params and builds SQL WHERE clauses:

```javascript
function getDateFilter(url) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from && !to) return { turnWhere: '', convWhere: '', params: [] };
  const clauses = [];
  const params = [];
  if (from) { clauses.push('t.timestamp >= ?'); params.push(from + 'T00:00:00'); }
  if (to)   { clauses.push('t.timestamp <= ?'); params.push(to + 'T23:59:59'); }
  return { turnWhere: 'AND ' + clauses.join(' AND '), params };
}
```

All four data endpoints now accept the filter:
- `GET /api/summary?from=...&to=...` — when filtered, uses `JOIN` instead of `LEFT JOIN` to only count conversations with turns in range
- `GET /api/conversations?from=...&to=...` — inner joins on turns in date range
- `GET /api/daily?from=...&to=...` — filters turn timestamps
- `GET /api/models?from=...&to=...` — filters turn timestamps

### Frontend changes (`token-tracker/index.html`)

Filter bar HTML with pill-shaped buttons:

```html
<div class="filter-bar">
  <button class="filter-btn" data-filter="today">Today</button>
  <button class="filter-btn active" data-filter="week">Week</button>
  <button class="filter-btn" data-filter="month">Month</button>
  <button class="filter-btn" data-filter="year">Year</button>
  <button class="filter-btn" data-filter="all">All</button>
</div>
```

JavaScript computes ISO date ranges from presets and appends query strings to all API calls:

```javascript
function getDateRange(filter) {
  const now = new Date();
  const to = now.toISOString().split('T')[0];
  let from;
  switch (filter) {
    case 'today': from = to; break;
    case 'week':  from = new Date(now - 7 * 86400000).toISOString().split('T')[0]; break;
    case 'month': from = new Date(now - 30 * 86400000).toISOString().split('T')[0]; break;
    case 'year':  from = new Date(now - 365 * 86400000).toISOString().split('T')[0]; break;
    default:      return ''; // 'all'
  }
  return `?from=${from}&to=${to}`;
}
```

The active filter is shown in the live indicator line.

### Presets

| Filter | Range | Default |
|--------|-------|---------|
| Today | Current day only | |
| Week | Last 7 days | ✅ |
| Month | Last 30 days | |
| Year | Last 365 days | |
| All | No filter (entire history) | |

## Enhancement: Day Detail View with Reasoning Tokens

**Date:** 2026-07-13

### Problem

The main dashboard provides aggregate views (summary cards, daily chart, model doughnut) and an expandable conversations table — but when the Today filter shows 1.8M+ input tokens in a single day, there is no way to quickly drill into *which specific turns within which sessions* consumed those tokens. The cache hit savings card shows overall numbers, but not the per-turn breakdown of cache reads vs writes. Additionally, reasoning tokens (exposed by models like DeepSeek-v4) were present in session JSONL files but were never being captured or displayed anywhere.

### Solution

#### 1. Database: `reasoning_tokens` column

Added `reasoning_tokens INTEGER DEFAULT 0` to the `turns` table schema (`init_db.mjs`) and migrated the existing database via `ALTER TABLE`. Historical data was cleared and re-imported to populate the new column.

#### 2. Sync: capture reasoning tokens

Updated `sync_sessions.mjs` to read `u.reasoning` from the session JSONL usage object (field: `reasoning`) and store it in the new `reasoning_tokens` column:

```javascript
cacheHit = u.cacheRead || 0;
cacheMiss = u.cacheWrite || 0;
reasoningTokens = u.reasoning || 0;  // NEW
```

The `INSERT` statement now includes `reasoning_tokens` as the 11th bound parameter.

#### 3. Summary API: `total_reasoning_tokens`

Extended the `GET /api/summary` endpoint in `server.mjs` to aggregate `SUM(t.reasoning_tokens)` in both the filtered and unfiltered query variants:

```sql
COALESCE(SUM(t.reasoning_tokens), 0) AS total_reasoning_tokens
```

#### 4. Dashboard: "Details" button (Today-only)

Added a **🔍 View Day Details** button on the main token tracker page that appears **only when the Today filter is active**. It sits below the summary cards, centered. CSS visibility is toggled via `.detail-btn-wrap.visible` class, controlled in `setFilter()`:

```javascript
const detailWrap = document.getElementById('detail-btn-wrap');
if (detailWrap) {
  detailWrap.classList.toggle('visible', filter === 'today');
}
```

Clicking the button navigates to `/token-tracker/today`.

#### 5. New page: Day Detail (`/token-tracker/today/index.html`)

A **master-detail layout** page showing today's token consumption with session-level drill-down:

- **Summary bar**: Total tokens, conversations, input, output, cache read, reasoning
- **Left panel** (380px, scrollable): List of today's conversations with time, model badge, turn count, and token count. Newest first.
- **Right panel** (fills remaining space): When a conversation is clicked, displays a turn-by-turn token breakdown table with columns:

  | Time | Input | Output | Cache Read | Cache Write | Reasoning | Total |
  |------|-------|--------|------------|-------------|-----------|-------|

  - **Horizontal scroll** when columns overflow (min-width: 700px on table)
  - Turns filtered to show only those with non-zero token consumption
  - **Footer row** with column totals
  - **Newest turns first** — most recent activity at the top

- **Static page**: No auto-refresh (loaded only on navigation, conserves resources)

#### 6. Server: `/token-tracker/today` route

Added route in `server.mjs` (before the catch-all `/token-tracker/*`):

```javascript
if (path === '/token-tracker/today' || path === '/token-tracker/today/') {
  return serveStatic(res, join(__dirname, 'token-tracker', 'today', 'index.html'));
}
```

The new page reuses existing APIs: `GET /api/summary?from=...&to=...` and `GET /api/conversations/:id/turns` — no new endpoints needed.

### Usage flow

```
Token Tracker (/token-tracker)
  │
  ├─ Click "Today" filter
  │     └─ 🔍 View Day Details button appears
  │
  └─ Click "View Day Details"
        └─ /token-tracker/today
              ├─ Summary bar: day aggregates
              ├─ Left: today's conversations list
              └─ Right: click a conversation → per-turn token table
```

## All files touched

| File | Action |
|------|--------|
| `html/server.mjs` | Updated: multi-section routing, auto-sync, DB path, reasoning in summary, `/token-tracker/today` route |
| `html/index.html` | Created: dashboard homepage with section cards |
| `html/token-tracker/index.html` | Moved from root + added back-link, filter bar, Details button |
| `html/token-tracker/sync_sessions.mjs` | Created: session JSONL → DB importer; updated: reasoning tokens capture |
| `html/token-tracker/init_db.mjs` | Updated: `synced_sessions` table, `reasoning_tokens` column, DB path |
| `html/token-tracker/record_turn.mjs` | Updated: DB path |
| `html/token-tracker/today/index.html` | Created: day detail master-detail page |
| `html/token-tracker/db/token_usage_tracker.db` | Renamed from `db/tokens.db`; migrated: `reasoning_tokens` column |