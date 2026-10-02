# Pi State Summary

> *Last updated: 2026-10-02*
> *Living document — reflects current state, not history.*

---

## Quick Facts

- **Pi version**: 1.0.0, Node v24.21.0 via nvm
- **Config dir**: `/home/pmpmt/.pi/agent/`
- **Provider**: DeepSeek (direct API key)
- **Default model**: `deepseek-flash`
- **Enabled models**: `deepseek-v4-pro`, `deepseek-flash`
- **Thinking**: high (default)
- **Location**: Vila Real, Portugal (Europe/Lisbon)

---

## What's Running

### 1. Pi Dashboard
- **Entry**: `node /home/pmpmt/.pi/html/server.mjs` (port 3000)
- **Landing page**: Cards for Token Tracker, Backup Tool, Cron Jobs, Skills, Agent Map, Video Finder
- **Sub-pages**: `/token-tracker` (usage analytics), `/backup` (backup tool), `/skills`, `/agentmap`, `/video-finder`, `/codebase-summary`

### 2. Token Tracker
- **Location**: `/home/pmpmt/.pi/html/token-tracker/`
- SQLite backend: `db/token_usage_tracker.db`
- Auto-syncs from Pi sessions every 30s via `sync_sessions.mjs`
- REST API at `/api/summary`, `/api/conversations`, `/api/daily`, `/api/models`

### 3. Laptop Backup Tool
- **Location**: `/home/pmpmt/.pi/apps-scripts/backup_laptop_tool/`
- systemd timer: runs 5 min after boot, creates `.tar.gz` of `~/.pi` → Google Drive (`neopmpmtj@gmail.com`)
- Web UI at `http://localhost:3000/backup` (settings, manual backup, OAuth, logs)
- Credentials in `~/.pi/agent/.env`

### 4. Cron Job System
- **Location**: `~/.pi/cron/` (engine) + `~/.pi/agent/extensions/cron.ts` (extension)
- Schedule types: `at` (one-shot), `every` (interval), `cron` (5-field expressions)
- Persistence: `~/.pi/cron/jobs.json` + per-job JSONL run history in `~/.pi/cron/runs/`
- Tools: `cron` (agent) + `/cron` (TUI command)

### 5. Multi-Agent Orchestrator (pi-subagent)
- **Package**: `@mjakl/pi-subagent`
- **Tool**: `subagent` — delegates to specialized sub-agents in isolated Pi RPC processes
- **Agent definitions**: `~/.pi/agent/agents/*.md` (YAML frontmatter + Markdown body)
- **Active agents** (`~/.pi/agent/agents/`):
  - `frontend` — HTML/CSS/JS/UI (low thinking, tools: read,write,edit,bash). ⚠️ Sets `model: deepseek-v4-flash`, which is **not** in `enabledModels` — risks an OpenRouter fallback failure.
  - `researcher` — Web research returning sourced summaries (low thinking, tools: read, grep, find, ls, web_search). Model `deepseek-flash`.
  - Removed: `explore`
- Each agent gets its own clean system prompt. No orchestrator context pollution.

### 6. Pi Web Access
- **Package**: `pi-web-access`
- Tools: `web_search`, `fetch_content`, `get_search_content`
- Multi-provider search (OpenAI, Brave, Exa, Tavily, Perplexity, Gemini)
- Fetches web pages, YouTube transcripts, GitHub repos, local video frames

### 7. Pi Agent Browser Native
- **Package**: `pi-agent-browser-native`
- Tool: `agent_browser` — full browser automation
- Snapshots, clicks, fills, screenshots, eval, Electron support

### 8. Sub-Agent Pool (legacy, co-exists)
- **Package**: `pi-agents-pool` (v0.2.0)
- Tools: `spawn_agent`, `send_input`, `wait_agent`, `close_agent`, `resume_agent`
- Still installed but superseded by `pi-subagent` for new work

### 9. Custom Extensions
- `~/.pi/agent/extensions/cron.ts` — Cron job system (/cron command + cron tool)
- `~/.pi/agent/extensions/git-commit.ts` — `/commit [message]`
- `~/.pi/agent/extensions/observability/index.ts` — Run recording to `~/.pi/agent/observability/runs.jsonl`

### 10. Event Tracer (project-local, toggleable)
- **Location**: `~/.pi/.pi/extensions/pi-event-tracer/index.ts`
- Logs all 32 Pi events to `/tmp/pi-event-trace-<timestamp>.log`
- Captures full system prompt to `/tmp/pi-system-prompt.txt` on every prompt
- Only loads when cwd = `~/.pi/` (project-local). Rename to `index.ts.disabled` to disable.

### 11. Custom Prompts
- `~/.pi/agent/prompts/document.md` — Auto-document the most recent change
- `~/.pi/agent/prompts/readocs.md` — Read all Pi documentation files
- `~/.pi/agent/prompts/short.md` — Summarize last response

### 12. Skills

Discovered recursively from `~/.pi/agent/skills/<name>/SKILL.md`. Only `name` + `description` load at startup; the body loads on trigger (`/skill:<name>` forces it). Validate any skill with:

```bash
python3 ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py <skill-dir>
```

**Loading correctly (4):**
- `gog-workspace` — Google Workspace (Gmail, Calendar, Drive, Contacts, Sheets, Docs). Note: carries a non-spec `version:` key; pi tolerates it, the spec validator flags it.
- `skill-creator` — Create, edit, and evaluate skills (vendored Apache 2.0 copy of `anthropics/skills`; see its `ATTRIBUTION.md`)
- `video-finder` — Find YouTube videos by topic or reference
- `yt-download` — Download YouTube videos offline via yt-dlp

**On disk but NOT loading (1):**
- `partner-agent-export` — Export/import a partner agent as a self-contained installer. **Broken frontmatter:** the description contains an unquoted `model: ships` (col 367), so YAML parsing fails and pi silently skips the skill.

Removed since last revision: `librarian`.

### 13. Apps-Scripts
- `/home/pmpmt/.pi/apps-scripts/on-demand-stt-rewrite/` — Speech-to-text + text rewrite
- `/home/pmpmt/.pi/apps-scripts/temp_holding_folder/` — Temp storage for installs

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
| Installed packages | pi-web-access, pi-agent-browser-native, pi-agents-pool, @mjakl/pi-subagent |
| Enabled models | deepseek-v4-pro, deepseek-v4-flash |

---

## Key Files

| File | Purpose |
|---|---|
| `~/.pi/agent/settings.json` | All Pi settings |
| `~/.pi/agent/AGENTS.md` | Orchestrator instructions (delegation protocol, specialists) |
| `~/.pi/agent/APPEND_SYSTEM.md` | Location context, secrets rule, CLI hygiene |
| `~/.pi/agent/.env` | API keys and secrets (sourced by wrapper) |
| `~/.pi/agent/auth.json` | Provider auth (DeepSeek, Gemini) |
| `~/.pi/agent/agents/frontend.md` | Front-end sub-agent definition |
| `~/.pi/agent/agents/researcher.md` | Web research sub-agent definition |
| `~/.pi/agent/prompts/document.md` | Auto-documentation prompt |
| `~/.pi/agent/skills/skill-creator/SKILL.md` | Skill authoring methodology (create/edit/evaluate) |
| `~/.pi/agent/skills/skill-creator/scripts/quick_validate.py` | Skill frontmatter/spec validator |
| `~/.pi/agent/skills/skill-creator/ATTRIBUTION.md` | Vendored-source provenance + content hashes |
| `~/.pi/agent/extensions/cron.ts` | Cron job extension |
| `~/.pi/agent/extensions/git-commit.ts` | Git commit extension |
| `~/.pi/agent/extensions/observability/index.ts` | Run observability |
| `~/.pi/.pi/extensions/pi-event-tracer/index.ts` | Event tracer (project-local) |
| `~/.pi/cron/jobs.json` | Cron job store |
| `~/.pi/cron/runs/` | Per-job run history |
| `~/.pi/html/server.mjs` | Dashboard server entry point |
| `~/.pi/html/token-tracker/db/token_usage_tracker.db` | Token analytics DB |
| `~/.pi/agent/secrets/gdrive_token.json` | Google Drive OAuth token |
| `~/.pi/agent/secrets/service_account_key.json` | Google service account key |

---

## Reference Docs

`/home/pmpmt/.pi/miscelaneous_documentation/`:

| Directory | Topic |
|-----------|-------|
| `understand-pi-agent-internals/` | Full Pi internals (extensions, events, loop, prompt, cheatsheet, startup options) |
| `token-usage-dashboard-setup/` | Token tracker setup |
| `backup-laptop-tool-setup/` | Laptop backup tool |
| `backup-service-account-oauth-fix/` | Backup OAuth fix |
| `cron-job-system-setup/` | Cron job system |
| `multi-agent-orchestrator-setup/` | Multi-agent orchestrator (current + historical) |
| `skill-stale-commands-fix/` | Skill command fix |
| `speech-to-text-keyboard-shortcut-fix/` | STT keyboard fix |
