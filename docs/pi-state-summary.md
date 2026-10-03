# Pi State Summary

> *Last updated: 2026-10-03*
> *Living document — reflects current state, not history.*

---

## Quick Facts

- **Pi version**: 1.0.0 · **Node**: v24.21.0 (via nvm)
- **Launcher**: `/home/pmpmt/.local/bin/pi` — wrapper that sources `~/.pi/agent/.env`, pins node v24.21.0 on `PATH`, then execs the real pi binary
- **Config dir**: `/home/pmpmt/.pi/agent/`
- **Providers**: `deepseek` (default), `gemini` — `models-store.json` additionally carries `openrouter`, `google`, `openai` entries
- **Default model**: `deepseek-flash`
- **Enabled models**: `deepseek-v4-pro`, `deepseek-flash`
- **Thinking**: high (default)
- **Location**: Vila Real, Portugal (Europe/Lisbon)

---

## What's Running

### 1. Pi Dashboard
- **Entry**: `node /home/pmpmt/.pi/html/server.mjs`, listening on port **3000**
- **Landing cards**: Token Usage Tracker, Backup Tool, Skills, Agent Map, Codebase Summary, Documents, Cron Jobs
- **Sub-apps**: `/token-tracker`, `/backup`, `/agentmap`, `/video-finder`, `/codebase-summary`, `/skills` (placeholder page)

### 2. Token Tracker
- **Location**: `/home/pmpmt/.pi/html/token-tracker/`
- SQLite backend: `db/token_usage_tracker.db`
- The dashboard server spawns `sync_sessions.mjs` to import Pi sessions into the DB
- REST API: `/api/summary`, `/api/conversations`, `/api/daily`, `/api/models`, `/api/turns`

### 3. Laptop Backup Tool
- **Location**: `/home/pmpmt/.pi/apps-scripts/backup_laptop_tool/`
- systemd `my_PC_backup.timer` → `my_PC_backup.service` (system units, `OnBootSec=5min`, `Persistent=true`), runs the `.venv` python module
- Creates a `.tar.gz` snapshot of `~/.pi` → Google Drive (`neopmpmtj@gmail.com`)
- Web UI at `http://localhost:3000/backup` (settings, manual backup, OAuth, logs)
- Credentials in `~/.pi/agent/.env` and `~/.pi/agent/secrets/`

### 4. Cron Job System
- **Location**: `~/.pi/cron/` (engine: `store.ts`, `schedule.ts`, `types.ts`, `normalize.ts`) + `~/.pi/agent/extensions/cron.ts` (extension)
- Schedule types: `at` (one-shot), `every` (interval), `cron` (5-field expressions)
- Persistence: `~/.pi/cron/jobs.json` + per-job JSONL run history in `~/.pi/cron/runs/`
- Interfaces: `cron` tool (agent) + `/cron` (TUI command)
- **Active jobs**:
  - `Daily Laptop Backup` — `20 8 * * *`, agentTurn — last run: **error**
  - `gog-token-keepalive` — `0 8 * * *`, agentTurn — last run: ok

### 5. Multi-Agent Orchestrator (pi-subagent)
- **Package**: `@mjakl/pi-subagent` v3.1.0
- **Tool**: `subagent` — delegates to specialized sub-agents in isolated Pi RPC processes
- **Agent definitions**: `~/.pi/agent/agents/*.md` (YAML frontmatter + Markdown body)
- **Active agents**:
  - `frontend` — HTML/CSS/JS/UI (thinking low; tools: read, write, edit, bash). Model `deepseek-flash`.
  - `researcher` — web research returning sourced summaries (thinking low; tools: read, grep, find, ls, web_search). Model `deepseek-flash`.
- Each agent gets its own clean system prompt; no orchestrator context pollution.

### 6. Pi Web Access
- **Package**: `pi-web-access` v0.35.0
- Tools: `web_search`, `fetch_content`, `get_search_content`
- Multi-provider search (OpenAI, Brave, Exa, Tavily, Perplexity, Gemini) and page/YouTube/GitHub fetching

### 7. Pi Agent Browser Native
- **Package**: `pi-agent-browser-native` v0.9.1
- Tool: `agent_browser` — snapshots, clicks, fills, screenshots, eval, Electron automation

### 8. Sub-Agent Pool (legacy, co-exists)
- **Package**: `pi-agents-pool` v0.2.0
- Tools: `spawn_agent`, `send_input`, `wait_agent`, `close_agent`, `resume_agent`
- Superseded by `pi-subagent` for new work

### 9. Custom Extensions (`~/.pi/agent/extensions/`)
- `cron.ts` — cron job system (`/cron` command + `cron` tool)
- `git-commit.ts` — `/commit [message]`
- `observability/index.ts` — run recording to `~/.pi/agent/observability/runs.jsonl`
- `secret-scrubber.ts` — redacts secrets from tool outputs before they reach the model (writes `agent/events.log`)
- `pi-prompt-capture.ts` — symlink → `~/.pi/agent/skills/pi-prompt-dump/extensions/pi-prompt-capture.ts`; captures prompts to `~/.pi/agent/state/prompt-capture/`

### 10. Project-Local Extensions (load only when cwd = `~/.pi/`)
- `.pi/extensions/pi-event-tracer/index.ts` — logs Pi events; can capture the full system prompt to `/tmp/`
- `.pi/extensions/session-memory/index.ts` — captures raw session data on exit (`/new`, `/fork`, quit) into `~/.pi/sessions-summaries/`

### 11. Custom Prompts (`~/.pi/agent/prompts/`)
- `document.md` — auto-document the most recent change
- `dump.md` — dump the live system prompt/instruction files
- `explore-pi.md` — explore the Pi installation
- `readocs.md` — read all Pi documentation files
- `short.md` — summarize the last response

### 12. Skills

Discovered recursively from `~/.pi/agent/skills/<name>/SKILL.md`. Only `name` + `description` load at startup; the body loads on trigger (`/skill:<name>` forces it).

**Each skill is now its own private GitHub repo** (cloned in place, so `git pull` / `git push` work inside the skill folder). The parent `pi-workspace` repo no longer tracks them and ignores them via `.gitignore`.

| Skill | Repo (private) |
|---|---|
| `gog-workspace` | `neopmpmtj/skill-gog-workspace` |
| `partner-agent-export` | `neopmpmtj/skill-partner-agent-export` |
| `pi-prompt-dump` | `neopmpmtj/skill-pi-prompt-dump` |
| `skill-creator` | `neopmpmtj/skill-skill-creator` |
| `video-finder` | `neopmpmtj/skill-video-finder` |
| `yt-download` | `neopmpmtj/skill-yt-download` |

- `gog-workspace` — Google Workspace (Gmail, Calendar, Drive, Contacts, Sheets, Docs). Carries a non-spec `version:` key — **kept deliberately** (upstream skill-packaging metadata; pi tolerates it, the spec validator flags it). Ships `INSTALL.md` + `scripts/install.sh` for from-scratch installs on any server.
- `partner-agent-export` — package/ship a partner agent as a self-contained installer, and import it on another Pi.
- `pi-prompt-dump` — reproduce the live Pi system prompt and instruction files; owns the `pi-prompt-capture` extension.
- `skill-creator` — create, edit, and evaluate skills (vendored Apache 2.0 copy of `anthropics/skills`; see its `ATTRIBUTION.md`).
- `video-finder` — find YouTube videos by topic or reference.
- `yt-download` — download YouTube videos offline via yt-dlp.

Validate any skill with:

```bash
python3 ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py <skill-dir>
```

**Private but not installed** (GitHub only, no local copy yet): `neopmpmtj/skill-authoring-skills`, `neopmpmtj/skill-eliciting-project-model`.

### 13. Partner Agents
- **Registry**: `~/.pi/agent/partner-agents/partner-agents.list` (one absolute workspace path per line)
- **Tooling**: `setup-pi-agent.sh` (create), `push-partner-agents.sh` (sync all), `export-partner-agent.sh` (build an installer), plus `shared/` and `gitignore.template`
- **Installed**: `explore-discover` at `~/.pi/explore-discover` — its own repo (`neopmpmtj/explore-discover`), clean on `main`
- **Exports**: `~/.pi/agent/partner-agents/exports/<name>/install-<name>.sh`
- Workflow documented by the `partner-agent-export` skill

### 14. Apps-Scripts
- `/home/pmpmt/.pi/apps-scripts/backup_laptop_tool/` — Google Drive backup tool
- `/home/pmpmt/.pi/apps-scripts/ExplainLike12/` — explain-like-I'm-12 tool
- `/home/pmpmt/.pi/apps-scripts/on-demand-stt-rewrite/` — speech-to-text + text rewrite
- `/home/pmpmt/.pi/apps-scripts/text-to-speech/` — text-to-speech app
- `/home/pmpmt/.pi/apps-scripts/temp_holding_folder/` — temp storage for installs

### 15. Vendored Binaries
- `~/.pi/agent/bin/fd`, `~/.pi/agent/bin/rg` — pinned copies used by tools that expect `fd`/`rg`

---

## Key Configuration

| Config | Value |
|---|---|
| Theme | dark |
| Default provider / model | deepseek / deepseek-flash |
| Thinking level | high |
| Compaction | enabled |
| Steering mode | one-at-a-time |
| Follow-up mode | one-at-a-time |
| Tree filter mode | all |
| Double-escape action | tree |
| HTTP idle timeout | 120s |
| Image auto-resize | true |
| Terminal progress | shown |
| Installed packages | pi-web-access 0.35.0, pi-agent-browser-native 0.9.1, pi-agents-pool 0.2.0, @mjakl/pi-subagent 3.1.0 |
| Enabled models | deepseek-v4-pro, deepseek-flash |
| MCP servers | none |

All settings live in `~/.pi/agent/settings.json`.

---

## Version Control

| What | Where | State |
|---|---|---|
| Main workspace | `/home/pmpmt/.pi` → `neopmpmtj/pi-workspace` (private) | local `main` is **ahead of origin** (unpushed commits); only session/model state files are dirty |
| Each skill | `/home/pmpmt/.pi/agent/skills/<name>/` → `neopmpmtj/skill-<name>` (private) | clean on `main`, tracking origin; ignored by `pi-workspace` |
| Partner agent | `/home/pmpmt/.pi/explore-discover` → `neopmpmtj/explore-discover` (public) | clean on `main` |

Clone/update a skill directly at its path:

```bash
git -C ~/.pi/agent/skills/<name> pull     # update
git -C ~/.pi/agent/skills/<name> push     # publish changes
```

Private repos require GitHub auth on any machine you clone them from (SSH key or `gh auth login`).

---

## Key Files

| File | Purpose |
|---|---|
| `~/.local/bin/pi` | Pi launcher wrapper (loads `.env`, pins node) |
| `~/.pi/agent/settings.json` | All Pi settings |
| `~/.pi/agent/.env` | API keys and secrets (sourced by the wrapper) |
| `~/.pi/agent/auth.json` | Provider auth (`deepseek`, `gemini`) |
| `~/.pi/agent/models-store.json` | Extra provider/model definitions |
| `~/.pi/agent/trust.json` | Project trust decisions |
| `~/.pi/agent/AGENTS.md` | Orchestrator instructions (delegation protocol, specialists) |
| `~/.pi/agent/APPEND_SYSTEM.md` | Location context, secrets rule, CLI hygiene |
| `~/.pi/agent/agents/frontend.md` | Front-end sub-agent definition |
| `~/.pi/agent/agents/researcher.md` | Web research sub-agent definition |
| `~/.pi/agent/prompts/*.md` | Custom prompts (`/document`, `/dump`, `/explore-pi`, `/readocs`, `/short`) |
| `~/.pi/agent/skills/<name>/SKILL.md` | The six skills (each a standalone repo) |
| `~/.pi/agent/skills/skill-creator/scripts/quick_validate.py` | Skill frontmatter/spec validator |
| `~/.pi/agent/extensions/{cron,git-commit,secret-scrubber,pi-prompt-capture}.ts` | Custom extensions |
| `~/.pi/agent/extensions/observability/index.ts` | Run observability |
| `~/.pi/.pi/extensions/{pi-event-tracer,session-memory}/index.ts` | Project-local extensions |
| `~/.pi/cron/jobs.json` / `~/.pi/cron/runs/` | Cron job store / run history |
| `~/.pi/agent/partner-agents/partner-agents.list` | Partner agent registry |
| `~/.pi/agent/partner-agents/export-partner-agent.sh` | Build a partner-agent installer |
| `~/.pi/html/server.mjs` | Dashboard server entry point |
| `~/.pi/html/token-tracker/db/token_usage_tracker.db` | Token analytics DB |
| `/etc/systemd/system/my_PC_backup.{timer,service}` | Backup schedule |
| `~/.pi/agent/secrets/gdrive_token.json` | Google Drive OAuth token |
| `~/.pi/agent/secrets/service_account_key.json` | Google service account key |

---

## Reference Docs

`/home/pmpmt/.pi/docs/`:

| Directory / file | Topic |
|-----------|-------|
| `understand-pi-agent-internals/` | Full Pi internals (extensions, events, loop, prompt, cheatsheet, startup options) |
| `token-usage-dashboard-setup/` | Token tracker setup |
| `backup-laptop-tool-setup/` | Laptop backup tool |
| `backup-service-account-oauth-fix/` | Backup OAuth fix |
| `cron-job-system-setup/` | Cron job system |
| `multi-agent-orchestrator-setup/` | Multi-agent orchestrator (current + historical) |
| `separate-pi-instances/` | Running separate Pi instances / workspaces |
| `skill-stale-commands-fix/` | Skill command fix |
| `speech-to-text-keyboard-shortcut-fix/` | STT keyboard fix |
| `text-to-speech-app-setup/` | Text-to-speech app |
| `gog-workspace-portable-install/` | Portable gog-workspace install (Google Console → pinned binary → keyring transplant → VPS rollout) |
| `yt-download-user-manual.md` | yt-download skill usage |
