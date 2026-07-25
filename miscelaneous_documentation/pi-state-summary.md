# Pi State Summary

> *Last updated: 2026-07-25 (pi-subagent integration)*
> *Living document — increment when we build something new or make a significant change.*

---

## Quick Facts

- **Pi version**: 0.81.1 (`pi-coding-agent`), Node v24.18.0 via nvm
- **Config dir**: `/home/pmpmt/.pi/agent/`
- **Provider**: DeepSeek (direct)
- **Default model**: `deepseek-v4-pro` (thinking: high)
- **Flash model**: `deepseek-v4-flash`
- **Location**: Vila Real, Portugal (Europe/Lisbon timezone)

---

## What We've Built So Far

### 1. Pi Dashboard & Token Tracker
- **Location**: `/home/pmpmt/.pi/html/`
- **Entry point**: `node server.mjs` (default port 3000)
- **Includes**:
  - Landing page with cards (Token Tracker, Backup Tool, Cron Jobs, Skills, + 2 coming soon)
  - Full token usage analytics: per-turn cost/tokens, daily stats, model breakdown, conversation drill-down
  - SQLite backend (`token-tracker/db/token_usage_tracker.db`), auto-syncs from pi sessions every 30s
  - REST API at `/api/summary`, `/api/conversations`, `/api/daily`, `/api/models`, etc.

### 2. Pi Web Access (installed package)
- **Package**: `npm:pi-web-access`
- Provides `web_search`, `fetch_content`, `get_search_content` tools
- Multi-provider search (OpenAI, Brave, Exa, Tavily, Perplexity, Gemini)
- Can fetch web pages, YouTube transcripts, GitHub repos, video frames
- Includes a `librarian` skill for deep open-source code questions
- Config: auto provider, auto-summary workflow

### 3. Pi Agent Browser Native (installed package)
- **Package**: `npm:pi-agent-browser-native`
- Provides `agent_browser` tool — full browser automation (open, snapshot, click, fill, eval, screenshot)
- Supports real browser workflows, web research, form filling, page extraction
- Includes Electron app support, job/QA presets, semantic actions, source lookups

### 4. Pi Vision Tool (installed package)
- **Package**: `npm:pi-vision-tool`
- Adds `describe_image` tool — lets non-vision models (like DeepSeek) delegate image analysis
- Vision model: `google/gemini-3.5-flash` via OpenRouter
- Auto-resizes images to 1568px, JPEG quality 85

### 5. Custom Git Extension
- **Location**: `/home/pmpmt/.pi/agent/extensions/git-commit.ts`
- Command: `/commit [message]` — stages all and commits (defaults to "checkpoint")

### 6. Custom Prompts
- **Location**: `/home/pmpmt/.pi/agent/prompts/`
  - `readocs.md` — reads all 28 pi documentation files for full context
  - `short.md` — summarizes last response to ~⅓ size

### 7. Apps-Scripts: On-Demand STT Rewrite
- **Location**: `/home/pmpmt/.pi/apps-scripts/on-demand-stt-rewrite/`
- Python project for speech-to-text and text rewriting (with venv, pydantic, Xlib, pyautogui)

### 8. Laptop Backup Tool
- **Location**: `/home/pmpmt/.pi/apps-scripts/backup_laptop_tool/`
- **Purpose**: Creates `.tar.gz` snapshots of `~/.pi` (excluding blacklisted dirs, but **including** `npm/node_modules` for pi-extension restore completeness) and uploads to Google Drive (`neopmpmtj@gmail.com`)
- **Trigger**: systemd timer 5 minutes after **each boot** (boot-only, no recurring schedule)
- **Dashboard**: Accessible at `http://localhost:3000/backup` — proxied from port 8765 by `pi_main_dashboard.service`. Web UI for settings, read-only blacklist display (with count badge), manual backup, OAuth re-auth, and log viewer. `← Back to Dashboard` nav link.
- **Main dashboard**: `pi_main_dashboard.service` serves port 3000 landing page with cards for Token Tracker, Backup Tool, Cron Jobs, and Skills
- **Credentials**: Centralized in `~/.pi/agent/.env` (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, Drive config)
- **Docs**: `miscelaneous_documentation/backup-laptop-tool-setup/`

### 9. Cron Job System
- **Location**: `~/.pi/cron/` (engine) + `~/.pi/agent/extensions/cron.ts` (extension)
- **Purpose**: First-class scheduled-task system for Pi — persistent jobs, CLI management, and an agent-accessible tool, all in-process (no Gateway required)
- **Schedule types**: `at` (one-shot ISO/relative), `every` (fixed interval with anchor), `cron` (5-field expressions with timezone)
- **Persistence**: JSON file store (`~/.pi/cron/jobs.json`) + append-only JSONL run history per job
- **Tools**: `cron` tool (agent-accessible: status, list, get, add, update, remove, run, runs) + `/cron` command (TUI interactive)
- **Key design**: Timer capped at 60s max to recover from laptop sleep; `timer.unref()` for clean print-mode exit; auto-delete for one-shot `at` jobs
- **Docs**: `miscelaneous_documentation/cron-job-system-setup/`

### 10. Multi-Agent Orchestrator (pi-subagent)
- **Location**: `~/.pi/agent/agents/*.md` (agent definitions) + `~/.pi/agent/AGENTS.md` (orchestrator instructions)
- **Package**: `npm:@mjakl/pi-subagent` — provides `subagent` tool for delegating to specialized sub-agents
- **Architecture**: Each agent is a Markdown file with YAML frontmatter. The orchestrator delegates via the `subagent` tool. Each subagent runs in its own isolated `pi` process (headless RPC mode) with its own system prompt.
- **Agent definitions**: Markdown files at `~/.pi/agent/agents/*.md` with YAML frontmatter (`name`, `description`, `tools`, `model`, `thinking`). The Markdown body becomes the agent's system prompt.
- **Available agents**: `frontend` (HTML/CSS/JS/UI), `explore` (codebase exploration, auto-created as starter)
- **Key design**: Clean context separation — subagents don't see the orchestrator's session history or full AGENTS.md. Each agent has its own tool allowlist and model/thinking settings.
- **Docs**: `miscelaneous_documentation/understand-pi-agent-internals/` (entire internals investigation)

---

## Key Configuration

| Config | Value |
|---|---|
| Theme | dark |
| Compaction | enabled |
| Steering mode | one-at-a-time |
| Follow-up mode | one-at-a-time |
| Tree filter | all |
| Double-escape action | tree |
| HTTP idle timeout | 120s |
| Terminal progress | shown |
| Images auto-resize | enabled |
| Hide thinking block | false |
| Installed packages | pi-web-access, pi-agent-browser-native, pi-agents-pool, pi-subagent |

---

## Key Files

| File | Purpose |
|---|---|
| `~/.pi/agent/settings.json` | All pi settings (orchestrator) |
| `~/.pi/agent/auth.json` | Provider API keys |
| `~/.pi/agent/web-search.json` | Web search config |
| `~/.pi/agent/vision-tool.json` | Vision tool config |
| `~/.pi/agent/AGENTS.md` | Orchestrator agent instructions (delegation protocol) |
| `~/.pi/agent/APPEND_SYSTEM.md` | Auto-detected location context |
| `~/.pi/agent/prompts/` | Custom prompt files |
| `~/.pi/agent/extensions/` | Custom extension files (cron.ts, git-commit.ts) |
| `~/.pi/agent/agents/frontend.md` | Front-End sub-agent definition (YAML + Markdown) |
| `~/.pi/agent/agents/explore.md` | Codebase exploration sub-agent (auto-created) |
| `~/.pi/cron/jobs.json` | Cron job persistent store |
| `~/.pi/cron/runs/` | Per-job run history (JSONL) |

---

## Reference Docs

- **Location**: `/home/pmpmt/.pi/miscelaneous_documentation/`
  - `understand-pi-agent-internals/` — Full Pi internals investigation (extensions, events, loop, prompt, sub-agents)
  - `token-usage-dashboard-setup/` — Full token tracker setup docs
  - `backup-laptop-tool-setup/` — Backup tool setup & integration report
  - `cron-job-system-setup/` — Cron job system architecture & implementation
  - `multi-agent-orchestrator-setup/` — Multi-agent orchestrator & specialist workspaces (pre-pi-subagent)

---

## Session History

- Orchestrator sessions: `/home/pmpmt/.pi/agent/sessions/--home-pmpmt-.pi--/`
- Token tracker DB auto-syncs from orchestrator sessions

---

## Change Log

| Date | What Changed |
|---|---|
| 2026-07-25 | **pi-subagent integration.** Installed `@mjakl/pi-subagent`. Created `~/.pi/agent/agents/frontend.md` with YAML frontmatter (tools, model, thinking). Updated orchestrator `AGENTS.md` delegation protocol to use `subagent` tool. Completed full Pi internals investigation (extensions, events, core loop, AgentSession, system prompt) — documented in `understand-pi-agent-internals/`. |
| 2026-07-19 | **Multi-agent orchestrator.** Installed `pi-agents-pool` (5 delegation tools). Created `agent-frontend/` specialist workspace with own AGENTS.md, APPEND_SYSTEM.md, settings.json, and isolated sessions. Configured orchestrator `AGENTS.md` with full delegation protocol. Auto-steer via `<subagent_notification>` from child `pi --mode rpc` processes. TUI widget for live agent status. |
| 2026-07-17 | **Cron job system.** Built in-process scheduler extension (`~/.pi/cron/` + `~/.pi/agent/extensions/cron.ts`). Three schedule types (at/every/cron). JSON persistence + JSONL run history. Agent-accessible `cron` tool + `/cron` TUI command. Research and architecture adapted from OpenClaw's cron implementation. |
| 2026-07-13 | **Secrets management.** Moved API keys out of plain-text `auth.json` into `~/.pi/agent/.env`. Pi resolves `$VAR` at runtime via wrapper script. Pattern established for all future secrets. |
| 2026-07-13 | **Created this document.** Summarized entire pi setup: dashboard, token tracker, web access, vision tool, git extension, prompts, STT script |
| 2026-07-13 | **Laptop backup tool.** Adapted VPS backup script for laptop use. Boot-triggered systemd timer (5min delay, no recurring). Web dashboard on port 8765 for settings + manual triggers. Centralized credentials in `~/.pi/agent/.env`. Switched Google Drive target to neopmpmtj@gmail.com (extra storage). Cache relocated inside tool directory for self-containment. |
| 2026-07-13 | **Dashboard integration.** Backup dashboard proxied to port 3000 at `/backup` (no more port 8765 memorization). Dashboard services hardened with ProtectHome=read-only, memory limits, restart=always. Landing page updated with Backup Tool card replacing "Documents (coming soon)". Removed `node_modules` from blacklist to include extensions for restore completeness. Blacklist display made read-only with count badge. Added `← Back to Dashboard` navigation link. |
