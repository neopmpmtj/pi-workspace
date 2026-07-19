# Pi Operations Console — Complete Proposal

## Summary

Turn `/agentmap` from a static D3.js architecture diagram (hardcoded data, no live info, 200KB+ CDN dependency) into a **live operations console** that shows your actual Pi installation — what's configured, what's running, and what's healthy. Zero external dependencies. Two new server endpoints. One page rewrite.

---

## 1. Current State Assessment

### What the page is now

- D3.js hierarchical tree with ~35 hardcoded leaf nodes across 6 categories
- Imports `d3.v7.min.js` from CDN (~200KB+)
- ~250 lines of D3-specific rendering code (zoom, pan, tooltips, click-to-expand)
- Describes Pi's *theoretical* architecture — identical for every user
- When you land on it, you learn nothing about your actual setup

### What it tells you (all fake/wrong for this installation)

- "Providers: OpenAI, Brave, Exa..." — none of these are configured here
- "Extensions: Custom Tools, Event Hooks, Custom UI..." — none of these are installed here
- Zero awareness of your actual skills, extensions, cron jobs, models, tokens, or backups

### What it doesn't tell you (all real)

- You have deepseek and gemini API keys configured
- You have 2 models enabled, 100+ available via OpenRouter
- You have 3 skills installed (gog-workspace, video-finder, librarian)
- You have 2 extensions (cron.ts, git-commit.ts)
- You have 1 active cron job (Daily Laptop Backup)
- Your backup system has 39 runs, 82% success, last run healthy
- You've consumed 96.2M tokens across 50 conversations at a cost of $7.13

---

## 2. Design Philosophy

### Core principle: Show what IS, not what could be.

Every data point comes from a live source — config files, APIs, filesystem, or database. Nothing is hardcoded. Install a new skill? It appears automatically. Backup fails? Red dot shows immediately. Add a cron job? It's listed on next refresh.

### Visual language

- **Cards in CSS grid** — same design language as the main dashboard
- Dark theme using the existing `:root` variables (`--surface`, `--border`, `--accent`, `--green`, `--red`, `--orange`, `--muted`, etc.)
- Each card has: icon + label header, 2–5 data rows, optional status dots
- Hover: subtle border accent (matching main dashboard card behavior)
- Health indicators: green/yellow/red/gray dots (same `.dot-health` classes from main dashboard)
- Model bars: thin horizontal bars using CSS background-width percentages
- No D3, no SVG, no CDN — pure HTML + CSS + vanilla JS `fetch()`

### Live vs. static

- All data fetched at page load via parallel `fetch()` calls
- "Refresh" button re-fires all fetches and updates a footer timestamp
- ~50ms loading placeholders (pulsing "—") while fetches resolve
- Each card independently resilient — one fetch failure doesn't affect others
- No caching — every request reads live state (local filesystem/SQLite, sub-millisecond)
- Architecture reference section (Section 6) is the ONLY static content — collapsed by default

---

## 3. Complete Layout Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  TOP BAR                                                                     │
│  ← Dashboard    Pi Operations Console                            [Refresh]   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌── SECTION 1: PROVIDERS & MODELS (2 cards side by side) ──────────────┐   │
│  │                                                                       │   │
│  │  ┌─ 🔑 Auth & Providers ───────────┐  ┌─ ⚡ Models ───────────────┐  │   │
│  │  │                                  │  │                           │  │   │
│  │  │  ● deepseek    API key ✓         │  │  Enabled        2 models  │  │   │
│  │  │  ● gemini      API key ✓         │  │  Available      100+      │  │   │
│  │  │  ● openrouter  Available         │  │  Default        v4-pro    │  │   │
│  │  │                                  │  │  Thinking       high      │  │   │
│  │  │  3 of 3 providers healthy        │  │                           │  │   │
│  │  │                                  │  │  Providers:               │  │   │
│  │  │                                  │  │  deepseek(2) ·            │  │   │
│  │  │                                  │  │  google(16) ·             │  │   │
│  │  │                                  │  │  openrouter(102)          │  │   │
│  │  └──────────────────────────────────┘  └───────────────────────────┘  │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌── SECTION 2: SKILLS, EXTENSIONS, CRON (3 cards side by side) ────────┐   │
│  │                                                                       │   │
│  │  ┌─ 🧩 Skills (3) ───────┐ ┌─ 🔌 Extensions (2) ─┐ ┌─ ⏰ Cron (1) ─┐ │   │
│  │  │                        │ │                      │ │              │ │   │
│  │  │  📧 gog-workspace      │ │  ⏰ cron.ts           │ │  ● Daily     │ │   │
│  │  │  Google Workspace CLI  │ │  Job scheduler        │ │  Backup      │ │   │
│  │  │  Gmail,Calendar,Drive  │ │  at/every/cron expr   │ │  Last: OK    │ │   │
│  │  │                        │ │  agentTurn payloads   │ │  28s · 08:20 │ │   │
│  │  │  🎬 video-finder       │ │  /cron command        │ │  Europe/     │ │   │
│  │  │  YouTube similar video │ │                       │ │  Lisbon      │ │   │
│  │  │  search, filter by     │ │  📝 git-commit.ts     │ │              │ │   │
│  │  │  duration/recency      │ │  Git stage + commit   │ │  Next:       │ │   │
│  │  │                        │ │  /commit <message>    │ │  tomorrow    │ │   │
│  │  │  📚 librarian          │ │                       │ │  08:20       │ │   │
│  │  │  OSS research with     │ │                       │ │              │ │   │
│  │  │  GitHub source cites   │ │                       │ │  1 active    │ │   │
│  │  └────────────────────────┘ └───────────────────────┘ └──────────────┘ │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌── SECTION 3: PACKAGES & DASHBOARDS (2 cards side by side) ───────────┐   │
│  │                                                                       │   │
│  │  ┌─ 📦 Installed Packages (3) ────┐  ┌─ 🌐 Web Dashboards ─────────┐ │   │
│  │  │                                │  │                              │ │   │
│  │  │  pi-web-access                 │  │  /              Home         │ │   │
│  │  │  Web search, fetch_content,    │  │  /token-tracker Tokens       │ │   │
│  │  │  librarian skill, video-finder │  │  /backup/       Backup       │ │   │
│  │  │  npm                           │  │  /skills/       Skills       │ │   │
│  │  │                                │  │  /video-finder  Video        │ │   │
│  │  │  pi-agent-browser-native       │  │  /agentmap      Console  ←   │ │   │
│  │  │  Browser automation, Electron, │  │                              │ │   │
│  │  │  snapshots, QA presets         │  │                              │ │   │
│  │  │  npm                           │  │                              │ │   │
│  │  │                                │  │                              │ │   │
│  │  │  pi-agents-pool                │  │                              │ │   │
│  │  │  Sub-agent spawning and        │  │                              │ │   │
│  │  │  pool management               │  │                              │ │   │
│  │  │  npm                           │  │                              │ │   │
│  │  └────────────────────────────────┘  └──────────────────────────────┘ │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌── SECTION 4: BACKUP & TOKENS (2 cards side by side) ─────────────────┐   │
│  │                                                                       │   │
│  │  ┌─ 🗄 Backup System ──────────────┐  ┌─ 📊 Token Usage (all-time) ┐ │   │
│  │  │                                  │  │                             │ │   │
│  │  │  ● Healthy                       │  │  96.2M total tokens         │ │   │
│  │  │  Last backup: 10 minutes ago     │  │  $7.13 total cost            │ │   │
│  │  │                                  │  │  50 conversations            │ │   │
│  │  │  39 runs in last 30 days         │  │  3,705 turns                 │ │   │
│  │  │    32 passed · 7 failed          │  │                              │ │   │
│  │  │    82% success rate              │  │  Top models by volume:       │ │   │
│  │  │                                  │  │  deepseek-v4-pro  68.9M ████ │ │   │
│  │  │  Config:                         │  │  glm-5.2          15.1M █    │ │   │
│  │  │    Drive folder: backups         │  │  deepseek(R)      11.9M █    │ │   │
│  │  │    Retention: 5 backups          │  │  deepseek-flash    0.2M      │ │   │
│  │  │    Hostname folders: on          │  │                              │ │   │
│  │  │    Auth: Service account         │  │                              │ │   │
│  │  │    Blacklist: 7 patterns         │  │                              │ │   │
│  │  └──────────────────────────────────┘  └──────────────────────────────┘ │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌── SECTION 5: AGENT CONFIGURATION (full-width card) ──────────────────┐   │
│  │                                                                       │   │
│  │  ┌─ ⚙️ Agent Configuration ────────────────────────────────────────┐ │   │
│  │  │                                                                   │ │   │
│  │  │  Role:                Orchestrator                                │ │   │
│  │  │  Defined Specialists: 1 (Front-End / worker)                      │ │   │
│  │  │                                                                   │ │   │
│  │  │  Settings:                                                        │ │   │
│  │  │    Theme:             dark         Compaction:     enabled         │ │   │
│  │  │    Default thinking:  high         Steering:       one-at-a-time   │ │   │
│  │  │    Follow-up:         one-at-a-time HTTP idle:     120s            │ │   │
│  │  │    Images:            auto-resize  Hide think:     off             │ │   │
│  │  │                                                                   │ │   │
│  │  │  Instruction Files:                                               │ │   │
│  │  │    APPEND_SYSTEM.md  not configured                               │ │   │
│  │  │    AGENTS.md         ~/.pi/agent/AGENTS.md (29 lines, 1.2 KB)     │ │   │
│  │  └───────────────────────────────────────────────────────────────────┘ │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌── SECTION 6: ARCHITECTURE REFERENCE (collapsible, collapsed by default) ┐ │
│  │                                                                          │ │
│  │  ┌─ 🗺 System Architecture                              [Expand ▾] ──┐  │ │
│  │  │  (hidden until expanded)                                            │  │ │
│  │  └────────────────────────────────────────────────────────────────────┘  │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  FOOTER: Pi Operations Console · last refreshed 2026-07-19 10:15:42          │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Card Specifications — Section by Section

### Section 1, Card A: 🔑 Auth & Providers

**Purpose:** Show which AI providers have API keys configured vs. available-but-unconfigured.

**Layout:**
- One row per provider
- Each row: colored dot + provider name + status text
- Footer line: "N of M providers healthy"

**Dot colors and logic:**

| Condition | Dot Color | Status Text |
|---|---|---|
| `auth.json` has key entry, key is non-empty | Green | "API key ✓" |
| Key references `$ENV_VAR` and env var IS set | Green | "API key ✓" |
| Key references `$ENV_VAR` and env var is NOT set | Orange | "⚠ env var not set" |
| Provider not in `auth.json` but available via package | Gray/neutral | "Available (via package)" |
| No auth.json entry and no package | Gray | "Not configured" |
| `auth.json` has key entry but key is empty string | Red | "Key is empty" |

**Providers to show:**
1. `deepseek` — from `auth.json → deepseek.key`
2. `gemini` — from `auth.json → gemini.key`
3. `openrouter` — available if `pi-web-access` is in `settings.packages`

**Data source:** `GET /api/config` → `.auth`

**Edge cases:**
- `auth.json` missing entirely → card shows "No auth.json found" with all gray dots
- Unexpected auth types → show type in muted text: "API key (custom)"

**Server-side logic:**
```javascript
// For each auth entry:
// - If key is plaintext (not starting with $) → configured:true
// - If key starts with $ → resolve env var → configured:true if set
// - NEVER return the actual key value
// - Return { provider, configured: bool, type: "api_key", viaPackage: bool|null }
```

---

### Section 1, Card B: ⚡ Models

**Purpose:** Show which models are enabled vs. available, default model, and thinking configuration.

**Layout:**
- Key metrics in 2×2 grid: Enabled / Available / Default / Thinking
- Footer: provider breakdown (deepseek(2) · google(16) · openrouter(102))

**Data source:** `GET /api/config` → `.settings` and `.models`

**Logic:**
- `enabledModels` from `settings.json` → count is the "Enabled" number, list is shown as comma-separated names
- Total model count = sum of `modelsStore[provider].models.length` across all providers
- `defaultModel` from `settings.json`
- `defaultThinkingLevel` from `settings.json` → show "high", "medium", "low", "minimal", or "off" (muted if off)

**Edge cases:**
- `enabledModels` is empty → "No models explicitly enabled (all available)"
- `models-store.json` is missing → "Model store not available"
- Default model not in enabled list → show with warning
- `defaultThinkingLevel` is null → show "provider default"

**Provider breakdown:**
- Iterate `models-store.json` providers
- Show each provider name + model count in parentheses
- Color providers the same way as auth card (green = configured, gray = store-only)

---

### Section 2, Card C: 🧩 Skills

**Purpose:** Show every skill installed in `~/.pi/agent/skills/` with name, emoji, and description.

**Layout:**
- One row per skill
- Each row: emoji (or default puzzle piece) + skill name (bold) + description on next line (muted, 100-char truncated)
- Header shows count: "🧩 Skills (3)"

**Data source:** `GET /api/capabilities` → `.skills[]`

**Parsing logic (server-side):**
1. `readdirSync` `~/.pi/agent/skills/` — filter directories only
2. For each directory, check for `SKILL.md`
3. Read `SKILL.md`, look for YAML frontmatter between `---` delimiters
4. Extract: `name`, `description`, `metadata.openclaw.emoji`
5. If frontmatter missing: use directory name as name, first non-empty non-heading line as description
6. Truncate descriptions to 120 characters

**Edge cases:**
- Skills directory doesn't exist → "No skills installed · Skills extend agent capabilities for specific domains"
- Directory exists but is empty → "No skills found · Add skills to ~/.pi/agent/skills/"
- `SKILL.md` without frontmatter → use filename as name, extract first paragraph as description

---

### Section 2, Card D: 🔌 Extensions

**Purpose:** Show every extension in `~/.pi/agent/extensions/` with description and registered commands.

**Layout:**
- One row per extension
- Each row: icon + extension filename (bold) + description on next line (muted)
- If extension registers commands, show them as inline tags
- Header shows count: "🔌 Extensions (2)"

**Data source:** `GET /api/capabilities` → `.extensions[]`

**Parsing logic (server-side):**
1. `readdirSync` `~/.pi/agent/extensions/` — filter `.ts` and `.js` files
2. Skip `.d.ts` files (type definitions)
3. Read file, find first block comment (`/** ... */` or `/* ... */`)
4. Extract heading + first paragraph from comment
5. Scan for `pi.registerCommand("...",` to find registered commands
6. If no comment found: use filename as name, "Pi extension" as description

**Edge cases:**
- Extensions directory doesn't exist → "No extensions installed · Extensions add custom tools, commands, and hooks"
- Directory exists but is empty → "No extensions found"
- Only `.d.ts` files → skip them all → "No extensions found"

---

### Section 2, Card E: ⏰ Cron Jobs

**Purpose:** Show all scheduled jobs with status, timing, and next-run information.

**Layout:**
- One job per row
- Each row: status dot + job name + schedule description
- Second line: last run status/duration + next run time (muted)
- Active jobs first, then disabled jobs (muted)
- Footer: "N active job(s)" count

**Data source:** `GET /api/capabilities` → `.cronJobs[]`

**Logic:**
- Read `~/.pi/cron/jobs.json`
- For each job, parse `state.lastRunStatus`: "ok" → green dot, "error" → red dot, no runs yet → gray dot
- Format `schedule` into human-readable text:
  - `kind: "cron"` → parse expression for common patterns ("daily at HH:MM", "every N hours", fallback to raw expression + timezone)
  - `kind: "at"` → "One-shot: <ISO timestamp>"
  - `kind: "every"` → "Every <interval>" (convert ms to human: 3600000 → "1 hour")
- Show `state.lastDurationMs` as human-readable ("28s", "1.5m")
- Compute "Next run" from `state.nextRunAtMs`:
  - If in the future → relative time ("tomorrow 08:20", "in 3 hours")
  - If in the past → orange "Overdue" indicator
  - If no next run (disabled/one-shot done) → "—"
- Disabled jobs at the bottom, dimmed, with "⏸ Paused" indicator

**Edge cases:**
- `jobs.json` doesn't exist → "No cron jobs configured · Schedule recurring agent turns"
- `jobs` array is empty → "No jobs scheduled"
- Job with `deleteAfterRun: true` that already ran → show as "One-shot · Completed" (grayed out)

---

### Section 3, Card F: 📦 Installed Packages

**Purpose:** Show installed Pi packages from `settings.json` with descriptions.

**Layout:**
- One row per package
- Each row: package name (bold) + description (muted) + source tag ("npm")
- Header shows count: "📦 Installed Packages (3)"

**Data source:** `GET /api/config` → `.packages[]`

**Logic:**
- Read `settings.json → packages` array
- Parse each entry:
  - If starts with `npm:` → extract package name, source = "npm"
  - If starts with `git:` or `github:` → source = "git"
  - Otherwise → raw string, source = "custom"
- Map known package names to descriptions via static lookup:

| Package Name | Description |
|---|---|
| `pi-web-access` | Web search, fetch_content, librarian skill, video-finder dashboard |
| `pi-agent-browser-native` | Browser automation via CDP — open pages, snapshots, clicks, form fills, Electron, QA presets |
| `pi-agents-pool` | Sub-agent spawning, pool management, parallel task execution |

- Unknown packages get: "Installed Pi package (no description available)"

**Edge cases:**
- No `packages` array → "No Pi packages installed · Packages extend agent capabilities"
- Empty array → same as above
- Mixed sources → show source tag for each

---

### Section 3, Card G: 🌐 Web Dashboards

**Purpose:** Show all available web dashboards as quick-launch links.

**Layout:**
- One row per dashboard
- Each row: route path (monospace, linked) + dash + description
- Current page highlighted: "← you are here"
- Header: "🌐 Web Dashboards"

**Data source:** Static list (dashboards change rarely; could be made dynamic by parsing server routes):

| Route | Name |
|---|---|
| `/` | Home Dashboard |
| `/token-tracker` | Token Usage Tracker |
| `/backup/` | Backup Tool |
| `/skills/` | Skills Hub |
| `/video-finder` | Video Finder |
| `/agentmap` | Operations Console |

**Logic:**
- Render as `<a href="...">` links
- Check `window.location.pathname` to highlight current page
- "← you are here" appears in muted text next to the current page entry

**Edge cases:**
- None significant — this is the simplest card

---

### Section 4, Card H: 🗄 Backup System

**Purpose:** Show backup health, recent run stats, and configuration in one glance.

**Layout:**
```
● Healthy · Last backup: 10 minutes ago

39 runs in the last 30 days
  32 passed · 7 failed
  82% success rate

Configuration:
  Drive folder:     backups
  Retention:        5 backups
  Hostname folders: on
  Auth:             Service account (no expiry)
  Blacklist:        7 patterns (.git, venv, .venv, node_modules, ...)
```

**Data source:** Three existing backup API endpoints:
- `GET /backup/api/stats` → `{total, succeeded, failed, period_days}`
- `GET /backup/api/history?limit=1` → `{runs: [{timestamp, success, duration_seconds, trigger_source}]}`
- `GET /backup/api/settings` → `{gdriveFolder, retentionCount, useHostnameSubfolder, tokenExists, serviceAccountKeyExists, blacklist, hostname}`

**Health dot logic (same as main dashboard):**
- No runs ever → gray dot, "No backups yet"
- Last run succeeded AND within 24 hours → green dot, "Healthy"
- Last run succeeded BUT older than 24h → yellow dot, "Due soon"
- Last run failed → red dot, "Last backup failed"
- Stats API fails → gray dot, "Status unavailable"

**Auth display:**
- If `serviceAccountKeyExists` → "Service account (no expiry)"
- If `tokenExists` but no SA → "OAuth token"
- Neither → "⚠ Not configured"

**Blacklist display:**
- Show first 5 patterns comma-separated
- If >5, append "... (+N more)"
- Total count in header: "N patterns"

**Edge cases:**
- API calls fail → "Backup data unavailable" with gray dot
- Zero runs but settings show configuration → "No backups yet · System is configured, run your first backup"
- Period days value from API → use it directly ("in the last 30 days")

---

### Section 4, Card I: 📊 Token Usage

**Purpose:** Show all-time token consumption with top-models breakdown.

**Layout:**
```
All-time totals:
  96.2M total tokens    $7.13 total cost
  50 conversations      3,705 turns

Top models by volume:
  deepseek-v4-pro         68.9M ████████████████████
  glm-5.2                 15.1M ████
  deepseek-v4-pro (OR)    11.9M ███
  deepseek-v4-flash        0.2M ▏
```

**Data source:** Two existing token API endpoints:
- `GET /api/summary` (no date filter) → `{total_tokens, total_cost, total_conversations}`
- `GET /api/models` (no date filter) → `[{model, total_tokens, cost, conversations}]`

**Turn count:** Currently not in `/api/summary` — would need to either:
- Add `turn_count` to the summary query (one-line SQL change), OR
- Fetch `/api/daily` and sum the `turns` field, OR
- Accept that turn count is a "nice to have" and show only what's available

**Bar chart logic:**
- Each model row has a horizontal bar
- Bar width = `(model.total_tokens / topModel.total_tokens) * 100%`
- Bars rendered as an inline span with percentage width + CSS background color
- Bar color: `var(--accent)` at full opacity for top model, decreasing opacity for subsequent models
- Models with <1% of top volume get a thin "▏" bar

**Number formatting:**
- `fmtNum(n)`: ≥1M → "1.5M", ≥1K → "1.5K", else raw
- `fmtCost(c)`: `$7.13`, `< $0.01`, `$0.00`

**Edge cases:**
- DB empty → "No token data yet · Start using Pi to collect data"
- Only one model → show it without bar (no relative comparison needed)
- Many models (10+) → show top 4, with "+N more models" footer

---

### Section 5, Card J: ⚙️ Agent Configuration

**Purpose:** Show the agent's role, specialists, key settings, and instruction file status.

**Layout:**
```
Role:                Orchestrator
Defined Specialists: 1 (Front-End / worker)

Settings:
  Theme:             dark          Compaction:      enabled
  Default thinking:  high          Steering:        one-at-a-time
  Follow-up:         one-at-a-time HTTP idle:       120s
  Images:            auto-resize   Hide think:      off
  Warnings:          anthropic extra usage

Instruction Files:
  APPEND_SYSTEM.md   not configured
  AGENTS.md          ~/.pi/agent/AGENTS.md (29 lines, 1.2 KB)
```

**Data source:** `GET /api/config` → `.settings`, `.agentMd`, `.appendSystemMd`

**Settings to show:** (from `settings.json`)

| Settings Key | Display As | Format |
|---|---|---|
| `theme` | Theme | Raw string |
| `compaction.enabled` | Compaction | "enabled" / "disabled" |
| `defaultThinkingLevel` | Default thinking | Lowercase (null → "provider default") |
| `steeringMode` | Steering | Raw string |
| `followUpMode` | Follow-up | Raw string |
| `httpIdleTimeoutMs` | HTTP idle | "<N>s" (convert from ms) |
| `images.autoResize` | Images | "auto-resize" or "off" |
| `hideThinkingBlock` | Hide think | "off" or "on" |
| `warnings` | Warnings | Comma-separated enabled warning keys |

**AGENTS.md parsing (server-side):**
- Check file exists
- Count lines
- Get file size
- Extract role: regex for "You are the \*\*Orchestrator\*\*" or similar heading patterns
- Extract specialists: find "Available Specialists" section, parse list items
- Return: `{path, lines, sizeBytes, role, specialists[]}`

**APPEND_SYSTEM.md:**
- Check if `~/.pi/agents/APPEND_SYSTEM.md` exists
- If exists: show path + line count
- If not: show "not configured" in muted text

**Edge cases:**
- `settings.json` missing → "No settings.json found" (unlikely, Pi won't run without it)
- `AGENTS.md` missing → "No AGENTS.md at ~/.pi/agent/AGENTS.md"
- `AGENTS.md` cannot be parsed → show path + size but "Could not parse role/specialists"
- Settings with nested keys like `compaction.enabled` → drill into JSON safely, default to "—" if path missing

---

### Section 6: 🗺 Architecture Reference

**Purpose:** Preserve the architectural knowledge from the original mind map in a scannable format — purely reference, collapsed by default.

**Layout (when expanded):**
- 3×2 card grid corresponding to the six architectural categories
- Each card has: category name + colored dot + list of children
- Child items are plain text, no interactivity needed
- No D3, no SVG, no animations — just a CSS grid

**Categories and children:**

| Tools | Skills | Extensions |
|---|---|---|
| File Ops: read, write, edit | gog-workspace (Google) | Custom Tools API |
| Shell: bash, cron | video-finder (YouTube) | Event Hooks (20+) |
| Web: web_search, fetch_content, get_search_content | librarian (OSS research) | Commands (/slash) |
| Browser: agent_browser, describe_image | | Custom UI (TUI widgets) |
| | | State Management (persist) |

| Providers | Infrastructure | User Context |
|---|---|---|
| OpenAI / Anthropic / Google | Session Manager (branching, compaction) | Location Awareness |
| xAI / DeepSeek / Qwen | Cron Scheduler (at, every, cron) | Secrets (.env) |
| 100+ via OpenRouter | Theme System (TUI styling) | Project Trust Resolution |
| Brave / Exa / Tavily (search) | Prompt Templates | AGENTS.md / APPEND_SYSTEM.md |
| Perplexity (search) | TUI Components (chat, editor, diff) | |
| | Keybindings (customizable) | |
| | SDK (extensions, providers, integrations) | |
| | Packages (npm/git installable) | |

**Toggle behavior:**
- Collapsed by default — shows only the header bar with `[Expand ▾]` button
- Click to expand — slides open, button changes to `[Collapse ▴]`
- Simple CSS `max-height` transition (no JS animation needed)
- Click again to collapse

**Data source:** Hardcoded HTML (only static section on the page)

---

## 5. New API Endpoints

Two new endpoints added to `server.mjs`, following the existing handler pattern.

### `GET /api/config`

**Returns:**

```json
{
  "auth": {
    "deepseek": { "configured": true, "type": "api_key" },
    "gemini": { "configured": true, "type": "api_key", "envVar": "GEMINI_API_KEY" },
    "openrouter": { "configured": true, "type": "via_package" }
  },
  "settings": {
    "defaultModel": "deepseek-v4-pro",
    "defaultProvider": "deepseek",
    "enabledModels": ["deepseek-v4-pro", "deepseek-v4-flash"],
    "theme": "dark",
    "compaction": true,
    "defaultThinkingLevel": "high",
    "steeringMode": "one-at-a-time",
    "followUpMode": "one-at-a-time",
    "httpIdleTimeoutMs": 120000,
    "imagesAutoResize": true,
    "hideThinkingBlock": false,
    "warnings": ["anthropicExtraUsage"]
  },
  "models": {
    "totalAvailable": 120,
    "providers": ["deepseek", "google", "openrouter"],
    "byProvider": {
      "deepseek": 2,
      "google": 16,
      "openrouter": 102
    },
    "enabledCount": 2
  },
  "packages": [
    { "name": "pi-web-access", "source": "npm",
      "desc": "Web search, fetch_content, librarian skill, video-finder dashboard" },
    { "name": "pi-agent-browser-native", "source": "npm",
      "desc": "Browser automation via CDP — open pages, snapshots, clicks, form fills, Electron, QA presets" },
    { "name": "pi-agents-pool", "source": "npm",
      "desc": "Sub-agent spawning, pool management, parallel task execution" }
  ],
  "agentMd": {
    "path": "~/.pi/agent/AGENTS.md",
    "lines": 29,
    "sizeBytes": 1200,
    "role": "Orchestrator",
    "specialists": ["Front-End (worker)"]
  },
  "appendSystemMd": {
    "exists": false,
    "path": null
  }
}
```

**Implementation notes:**
- Sanitizes auth values — NEVER returns actual API keys
- For `$ENV_VAR` references: checks `process.env` but returns only `{configured: true/false, envVar: "NAME"}`
- If `settings.json` has warnings as object `{anthropicExtraUsage: true}`, convert to array of enabled keys
- Package descriptions from a static lookup map (these two packages are well-known)
- Unknown packages get generic: "Installed Pi package"
- All file reads wrapped in try/catch — missing files return empty/fallback values, not 500 errors
- Handler follows existing pattern: function at top of router section, called in the route dispatcher

### `GET /api/capabilities`

**Returns:**

```json
{
  "skills": [
    {
      "name": "gog-workspace",
      "description": "Google Workspace CLI for Gmail, Calendar, Drive, Contacts, Sheets, and Docs. Full Google productivity suite from any AI agent.",
      "emoji": "📧",
      "version": "1.0.0",
      "requires": ["gog CLI"],
      "configurable": true
    },
    {
      "name": "video-finder",
      "description": "Finds YouTube videos similar to a reference video or topic description. Matches by topic, style, depth, or audience.",
      "emoji": null,
      "hasDashboard": true
    },
    {
      "name": "librarian",
      "description": "Research open-source libraries with evidence-backed answers and GitHub permalinks. Excels at navigating large open-source repos.",
      "emoji": null,
      "hasDashboard": false
    }
  ],
  "extensions": [
    {
      "name": "cron.ts",
      "description": "Scheduled job execution inside the Pi agent harness. Supports at, every, and cron schedules with agentTurn payloads and JSON persistence.",
      "commands": ["/cron"],
      "icon": "⏰"
    },
    {
      "name": "git-commit.ts",
      "description": "Stage all changes and commit (git add -A && git commit).",
      "commands": ["/commit"],
      "icon": "📝"
    }
  ],
  "cronJobs": [
    {
      "name": "Daily Laptop Backup",
      "enabled": true,
      "scheduleRaw": "20 8 * * *",
      "scheduleHuman": "Daily at 08:20",
      "timezone": "Europe/Lisbon",
      "lastRunStatus": "ok",
      "lastDurationMs": 28180,
      "lastDurationHuman": "28s",
      "nextRunAtMs": 1784532000000,
      "nextRunDescription": "tomorrow 08:20",
      "description": "Daily backup of ~/.pi configurations to Google Drive at 08:10 Lisbon time."
    }
  ]
}
```

**Implementation notes:**
- Skills: reads `SKILL.md` from each directory, extracts YAML frontmatter
  - If SKILL.md missing, uses directory name as fallback
  - If YAML frontmatter missing, uses first heading + paragraph as name/description
- Extensions: reads `.ts`/`.js` files, skips `.d.ts`
  - Parses JSDoc-style block comments for descriptions
  - Scans for `pi.registerCommand()` calls to extract command names
  - If no comment found, uses filename
- Cron: reads `jobs.json`
  - Parses cron expressions for common patterns (daily, hourly, etc.)
  - Computes human-readable "next run" relative time
  - All file reads wrapped in try/catch
  - Missing directories/files return empty arrays

---

## 6. Frontend Implementation

### JavaScript architecture

```javascript
// ── Footer ──
document.getElementById('footer-time').textContent = new Date().toLocaleString();

// ── Utility functions ──
// Reuse fmtNum, fmtCost, timeAgo, escHtml from main dashboard

// ── Section renderers (one async function per data source) ──

async function loadProviders() { ... }     // → Card A
async function loadModels() { ... }        // → Card B
async function loadSkills() { ... }        // → Card C
async function loadExtensions() { ... }    // → Card D
async function loadCronJobs() { ... }      // → Card E
async function loadPackages() { ... }      // → Card F
async function loadDashboards() { ... }    // → Card G (static, no API call)
async function loadBackup() { ... }        // → Card H
async function loadTokens() { ... }        // → Card I
async function loadConfig() { ... }        // → Card J

// ── Init ──
// All fetches fire in parallel
Promise.allSettled([
  loadProviders(), loadModels(), loadSkills(), loadExtensions(),
  loadCronJobs(), loadPackages(), loadBackup(), loadTokens(), loadConfig()
]);

// ── Refresh button ──
document.getElementById('btn-refresh').addEventListener('click', () => {
  // Re-fire all loaders
  // Update footer timestamp
});
```

**Fetch pattern (used by all loaders):**
```javascript
try {
  const res = await fetch('/api/config');
  const data = await res.json();
  // Populate card DOM
} catch (e) {
  card.querySelector('.card-content').innerHTML =
    '<span class="summary-loading" style="animation:none">Unavailable</span>';
}
```

**Loading states:**
- Cards start with `.summary-loading` placeholder text (pulsing "—")
- On success: replace innerHTML with actual data
- On failure: replace with static "Unavailable" text (no animation)
- Each card handles its own errors independently

### CSS approach

```css
/* Cards grid — responsive, matching main dashboard */
.ops-grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; margin-bottom: 20px; }
.ops-grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 20px; }

/* Card — same style as main dashboard .summary-panel */
.ops-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px 22px;
  transition: border-color 0.2s;
}
.ops-card:hover { border-color: var(--accent); }

/* Card header */
.ops-card-header {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 14px;
  font-size: 0.75rem; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--muted); font-weight: 600;
}

/* Model bar */
.model-bar {
  display: inline-block; height: 6px; border-radius: 3px;
  background: var(--accent); margin-left: 8px; vertical-align: middle;
}

/* Config key-value rows */
.config-row {
  display: flex; justify-content: space-between;
  font-size: 0.82rem; padding: 3px 0;
}
.config-row .key { color: var(--muted); }
.config-row .val { color: var(--text); font-weight: 500; }

/* Architecture reference — collapsible */
.arch-section { margin-top: 20px; }
.arch-toggle {
  cursor: pointer; user-select: none;
  padding: 12px 22px; border-radius: 12px;
  background: var(--surface); border: 1px solid var(--border);
}
.arch-content {
  max-height: 0; overflow: hidden;
  transition: max-height 0.3s ease;
}
.arch-content.open { max-height: 800px; }
```

### What gets removed from the current page

| Removed | Lines | Reason |
|---|---|---|
| `<script src="...d3.v7.min.js">` | 1 | 200KB+ CDN dependency, no longer needed |
| Hardcoded `data` object | ~200 | Static, wrong for this installation |
| D3 tree layout code | ~80 | `d3.tree()`, `d3.hierarchy()`, links, nodes |
| D3 zoom/pan code | ~20 | `d3.zoom()`, transform handling |
| D3 tooltip code | ~50 | `showTooltip`, `moveTooltip`, `hideTooltip` |
| D3 click/expand handlers | ~40 | `node.on('click', ...)`, `update(source)` |
| D3 resize handler | ~10 | `window.addEventListener('resize', ...)` |
| Legend component | ~15 | Category color legend |
| SVG canvas | ~5 | `svg`, `gRoot`, SVG element creation |

**Total removed:** ~420 lines of D3-specific code + the 200KB CDN import

**Total added:** ~350 lines of HTML + ~200 lines of CSS + ~250 lines of JS = ~800 lines (but simpler, no library, no complex state)

---

## 7. Files Changed

| File | Change | Lines |
|---|---|---|
| `/home/pmpmt/.pi/html/server.mjs` | Add `GET /api/config` handler | ~70 |
| `/home/pmpmt/.pi/html/server.mjs` | Add `GET /api/capabilities` handler | ~80 |
| `/home/pmpmt/.pi/html/server.mjs` | Add routes to dispatcher | ~4 |
| `/home/pmpmt/.pi/html/agentmap/index.html` | Complete rewrite | ~800 |

---

## 8. Summary of Gains

| Dimension | Before | After |
|---|---|---|
| **Data accuracy** | Hardcoded, identical for all users | Live, reflects actual installation |
| **Provider awareness** | Shows OpenAI, Brave, Exa (not configured) | Shows deepseek ●, gemini ●, openrouter ● |
| **Skill visibility** | Static list of 3 skill names | Live scan of filesystem, descriptions, emojis |
| **Extension visibility** | Shows features you don't have | Shows your 2 actual extensions with commands |
| **Cron visibility** | Describes scheduler as concept | Shows your 1 actual job with last-run status |
| **Operational data** | None | Backup health, token usage, model breakdown |
| **External dependencies** | d3.v7.min.js (200KB+ CDN) | Zero |
| **Code complexity** | D3 tree layout, zoom, tooltips | Vanilla JS fetch() + innerHTML |
| **Actionability** | Can't act on anything | Click-through to backup, tokens, skills, dashboards |
| **Resilience** | One JS error breaks the whole page | Each card independently handles its own errors |

---

## 9. Implementation Checklist

1. **Add `/api/config` to `server.mjs`** — reads settings, auth, models, agents, packages
2. **Add `/api/capabilities` to `server.mjs`** — scans skills dir, extensions dir, cron jobs
3. **Add route dispatch entries** — wire the two new endpoints
4. **Rewrite `agentmap/index.html`** — drop D3, build the 6-section console
5. **Test** — start server, visit `/agentmap`, verify all cards populate
6. **Verify** — check each edge case (missing files, empty arrays, API failures)

---

*Proposal prepared 2026-07-19. Awaiting user approval for implementation.*
