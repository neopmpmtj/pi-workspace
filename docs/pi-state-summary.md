# Pi State Summary

> *Last updated: 2026-11-01*
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
- **Package**: `pi-web-access` v0.44.0 (installed; pinned as `@0.44.0` in the `chat_meter_web` replica)
- Tools: `web_search`, `fetch_content`, `get_search_content`
- Multi-provider search (OpenAI, Brave, Exa, Tavily, Perplexity, Gemini) and page/YouTube/GitHub fetching

### 7. Pi Agent Browser Native
- **Package**: `pi-agent-browser-native` v0.9.1
- Tool: `agent_browser` — snapshots, clicks, fills, screenshots, eval, Electron automation

### 8. Sub-Agent Pool (legacy, co-exists)
- **Package**: `pi-agents-pool` v0.2.0 — **locally patched**
- Tools: `spawn_agent`, `send_input`, `wait_agent`, `close_agent`, `resume_agent`
- Superseded by `pi-subagent` for new work
- Patch: `extension/agent-pool.ts` `launchProcess` now exports `PI_SUBAGENT_STACK` (ancestor chain + this child's `agentType`), mirroring `@mjakl/pi-subagent`'s convention, so observability can attribute the child's agent name. Upstream sets only `PI_SUBAGENT_DEPTH`. **Lost on any package upgrade — re-apply.** The `resume_agent` path (`launchProcess` at ~line 367) passes no `agentType`, so resumed agents remain nameless.

### 9. Custom Extensions (`~/.pi/agent/extensions/`)
- `cron.ts` — cron job system (`/cron` command + `cron` tool)
- `git-commit.ts` — `/commit [message]`
- `observability/index.ts` — run recording to `~/.pi/agent/observability/runs.jsonl` and `runs.sqlite` (JSONL first, then SQLite insert). Captures subagent lineage (`parent_session_id`, `agent_name`, `handle`, `depth`) from `PI_SUBAGENT_DELEGATION` / `PI_SUBAGENT_STACK` / `PI_SUBAGENT_DEPTH`, with a `<tmp>/pi-subagents/<parent>/<child>.jsonl` path fallback. Token views `session_parent`, `session_root`, `run_tokens`, `session_tokens`, `agent_tokens`. `/tokens` command reports a root session's totals (orchestrator + all descendants) plus all-time totals by agent. Token model: `prompt = input + cacheRead + cacheWrite`, `completion = output` (with `reasoning` a **subset** of output, never additive). Forward-only since 2026-10-04: the 825 legacy JSONL runs are not backfilled into SQLite.
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
| `agent-replica-adapt` | `neopmpmtj/skill-agent-replica-adapt` |

- `gog-workspace` — Google Workspace (Gmail, Calendar, Drive, Contacts, Sheets, Docs). Carries a non-spec `version:` key — **kept deliberately** (upstream skill-packaging metadata; pi tolerates it, the spec validator flags it). Ships `INSTALL.md` + `scripts/install.sh` for from-scratch installs on any server.
- `partner-agent-export` — package/ship a partner agent as a self-contained installer, and import it on another Pi.
- `pi-prompt-dump` — reproduce the live Pi system prompt and instruction files; owns the `pi-prompt-capture` extension.
- `skill-creator` — create, edit, and evaluate skills (vendored Apache 2.0 copy of `anthropics/skills`; see its `ATTRIBUTION.md`).
- `video-finder` — find YouTube videos by topic or reference.
- `agent-replica-adapt` — turn a copy of `~/chat_meter` into a new isolated agent: rewrites every identity string, writes the launcher, verifies isolation. Deterministic `scripts/adapt.py` with a `--check` mode; validated clean by `quick_validate.py`. Cloned in place at `~/.pi/agent/skills/agent-replica-adapt` (branch `main`, tracking `origin/main`).
- `yt-download` — download YouTube videos offline via yt-dlp.

Validate any skill with:

```bash
python3 ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py <skill-dir>
```

**Private but not installed** (GitHub only, no local copy yet): `neopmpmtj/skill-authoring-skills`, `neopmpmtj/skill-eliciting-project-model`.

### 13. Partner Agents
- **Workspace convention**: each partner/sibling agent lives at `~/.pi/<name>` (own `PI_CODING_AGENT_DIR`, own git repo)
- **Registry**: `~/.pi/agent/partner-agents/partner-agents.list` (one absolute workspace path per line)
- **Tooling**: `setup-pi-agent.sh` (create — targets `~/.pi/<name>` and refuses reserved Pi directory names), `push-partner-agents.sh` (sync all), `export-partner-agent.sh` (build an installer — prefers `~/.pi/<name>`, falls back to the legacy `~/.pi/partner-agents/<name>`), plus `shared/` and `gitignore.template`
- **Installed**: `explore-discover` at `~/.pi/explore-discover` — its own repo (`neopmpmtj/explore-discover`), clean on `main`; `image-describer` at `~/image-describer` (see 13a)
- **Exports**: `~/.pi/agent/partner-agents/exports/<name>/install-<name>.sh`
- Workflow documented by the `partner-agent-export` skill

### 13a. image-describer
- **Workspace**: `~/image-describer/` — isolated `PI_CODING_AGENT_DIR`, own git repo, not in the partner registry
- **Launcher**: `~/.local/bin/pi-image-describer` — sources **only** `~/image-describer/.env`, bypassing `~/.local/bin/pi` (which hardcodes `source ~/.pi/agent/.env`)
- **Chat model**: `deepseek-flash`, thinking `low`
- **Directory descriptions**: extension `extensions/describe-images` — `/describe-images` and the `describe_images` tool. One vision request per file, oldest first. Descriptions stay in the session. The only file it writes is a JSONL run ledger (default `./logs/image-runs.jsonl`)
- **Vision models**: `deepseek-flash` (default), `gpt-5.4`, `gemini-3.8-flash`. Chat `enabledModels` stays `deepseek-flash`
- **Tools**: `read`, `grep`, `find`, `ls`, `describe_images`
- **Secrets**: own `.env` with `DEEPSEEK_API_KEY` (mode 600). `OPENAI_API_KEY` and `GEMINI_API_KEY` are optional and are not set. `auth.json` is deepseek-only
- **Runtime**: Node v24.21.0, local `package.json` (`sharp`, `exifr`). No skills, subagents, cron, or registry entry

### 13b. Imported agent group (`pi-agents-experts-grouped`)
- **Origin**: contents of `~/pi-agents-experts-grouped` copied into `~/.pi/` (2026-11-02), minus its top-level `.gitignore`, `.git` and `.gitmodules`. There it was a repo with four submodules; here they are plain directories, tracked by `pi-workspace`
- **Contents**: `cos-orchestrator-agent/`, `web-master/`, `gog-workspace-agents/`, `image-describer/`, `scripts/`, `config.json`, `xtra-info.md`, `.cursor/`, `.dashboard-logs/`
- **`config.json`**: input-routing thresholds — `lessThanInputWords` (6, enabled), `inputContainsPath`, `inputContainsUrl`, `inputContainsEmail` (all enabled, all print)
- **Excluded at import**: every `.env` and `auth.json` (each sub-project's own `.gitignore` covers them; they exist on disk at mode 600 and never enter git), plus `node_modules/` and build output — the copy is ~985 MB on disk but only ~2 MB of tracked source
- **Note**: `image-describer/` exists twice (here as `image-describer/image-describer/` and standalone at `~/image-describer/`)
- **Docs**: `~/image-describer/README.md`

### 13b. chat_meter
- **Workspace**: `~/chat_meter/` — repo root holds `.env` and `model-rates.json`; the agent home is `~/chat_meter/chat-meter/` (own `PI_CODING_AGENT_DIR`, own git repo, **not** in the partner registry, no remote yet)
- **Launcher**: `~/.local/bin/pi-chat-meter` — sources **only** `~/chat_meter/.env`, reads `default-model.json` (provider · model · thinking), execs `pi … --no-builtin-tools`. The switch applies to the next launch
- **Purpose**: plain chat, no tools, over three providers (DeepSeek `deepseek-flash`/`deepseek-v4-pro`, OpenAI `gpt-5.4`/`gpt-5.4-mini`, Google `gemini-3.8-flash`/`gemini-3.7-flash`), with every token recorded per run
- **Two channels**: `/ask` (extension, one direct request through `ctx.modelRegistry`, no chat turn, origin `command`) and ordinary chat turns (read back from `sessions/**/*.jsonl`, origin `chat`). Both fold into one run via `details.runId` + `parentId`
- **Commands**: `/ask "question" [--model|--provider|--effort|--timeout] [--set-default-*]`, `/usage [--all|--session|<runId>]`
- **Ledger**: `~/chat_meter/chat-meter/logs/ledger.sqlite` — `runs`, `calls`, `session_files` (byte offsets). Tokens stored, dollars derived from the rate card at read time (`effectiveFrom` versions); `cost_pi` kept as a cross-check. Schema changes empty the ledger on purpose
- **Dashboard**: `cd ~/chat_meter/chat-meter && npm run dashboard` → `http://127.0.0.1:8787`. One `node:http` process serves API + page (no Vite, no CORS list); SSE refresh; settings write `default-model.json`; root pinned to the folder above `dashboard/`, overridable with `DASHBOARD_ROOT`
- **Secrets**: own `.env` with `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (mode 600); `auth.json` holds `$ENV` references only
- **Runtime**: Node v24.21.0, local `package.json` (`@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, typescript), 68 tests, `npm run typecheck`
- **Docs**: `~/chat_meter/README.md`, `~/chat_meter/chat-meter/docs/CHEATSHEET.md`

### 13c. chat_meter_web
- **Workspace**: `~/chat_meter_web/` — an isolated replica of `~/chat_meter` (same code, own git history, no branch), agent home `~/chat_meter_web/chat-meter-web/`
- **Launcher**: `~/.local/bin/pi-chat-meter-web` — sources **only** `~/chat_meter_web/.env`, `PI_CODING_AGENT_DIR=~/chat_meter_web/chat-meter-web`, same `default-model.json` switch and `--no-builtin-tools` as the template
- **Isolation**: separate `.env`, agent home, `logs/ledger.sqlite` and `sessions/`; shares nothing with `~/chat_meter`, which stays clean as a template
- **Divergence point**: the web copy is where new behaviour is built; the template is copied from again for the next agent
- **Web access**: `pi-web-access@0.44.0`, installed into this agent's own `npm/` and loaded from `+dist/index.js`. `web-search.json` routes Brave → keyless Exa MCP → DuckDuckGo with `workflow: "none"`; `BRAVE_API_KEY`/`PERPLEXITY_API_KEY` are optional in its `.env`. Pinned per `chat-meter-web/docs/DEPENDENCIES.md`
- **Tool ledger**: `tool_calls` + `tool_files` tables created additively in the same `ledger.sqlite` (chat `SCHEMA_VERSION` unchanged). `ledger/search-ingest.ts` reads `toolResult` entries from session files with its own byte offsets, so past searches backfill; `ledger/tool-rates.ts` prices per query per provider (`rated`/`unrated`/`partial`). Shown by `/usage`, `/usage --tools` and the dashboard's Web searches section
- **Dashboard**: same `npm run dashboard` (defaults to port 8787; prints a clear message instead of a stack trace when the port is taken). Hash-routed tabs `#metrics` / `#settings`; settings sections for Model (`default-model.json`), Web search (route order + workflow + key markers, `web-search.json`), Prices (both cards, read-only, `unrated` flagged) and Prompts (read-only `/ask`); new routes `GET/PUT /api/search-route`, `GET /api/rates`, `GET /api/prompts`
- **Identity strings**: all rewritten to the new path, agent home and launcher (`trust.json`, `ledger/env.ts` fallback, `src/ask.ts`, `APPEND_SYSTEM.md`, README, CHEATSHEET, `package.json` name, `report.ts` footer prefix, extension custom types). `adapt.py --check` reports clean
- **Provenance**: adapted with the `agent-replica-adapt` skill; the template stays untouched so it can be copied again

### 14. Apps-Scripts
- `/home/pmpmt/.pi/apps-scripts/backup_laptop_tool/` — Google Drive backup tool
- `/home/pmpmt/.pi/apps-scripts/ExplainLike12/` — explain-like-I'm-12 tool
- `/home/pmpmt/.pi/apps-scripts/on-demand-stt-rewrite/` — speech-to-text + text rewrite
- `/home/pmpmt/.pi/apps-scripts/text-to-speech/` — text-to-speech app
- `/home/pmpmt/.pi/apps-scripts/temp_holding_folder/` — temp storage for installs

### 14a. Agents shared scripts
- `/home/pmpmt/.pi/agents-shared-scripts/session-slim/` — shared source for `slim_session.py` (readable session JSON in `~/.pi/sessions-slim/`). `--session` selects one file by filename or session id under `~/.pi/agent/sessions/`. Per-agent copies are not wired yet. Usage: `README.md` in that folder.

### 15. Vendored Binaries
- `~/.pi/agent/bin/fd`, `~/.pi/agent/bin/rg` — pinned copies used by tools that expect `fd`/`rg`

### 16. Standalone Agent — genesis-tester
- **Workspace**: `~/.pi/genesis-tester/` — outside the partner-agent framework (not in the registry); nested git repo (5 commits, **no remote**), excluded from `pi-workspace` via `~/.pi/.gitignore`
- **Launcher**: `pi-genesis-tester()` in `~/.bashrc:139` — `set -a` + sources the agent's **own** `.env`, then exports `PI_CODING_AGENT_DIR`
- **Config**: `settings.json` (deepseek / deepseek-flash / high), `auth.json` (own copy, `chmod 600`), `trust.json`, `.gitignore`
- **Stock prompt only**: no `AGENTS.md`, no `APPEND_SYSTEM.md`, no skills, no `packages` → tools are just `read`, `bash`, `edit`, `write`; the only extension is a `pi-prompt-capture.ts` symlink to the main agent's skill
- **Sessions**: `~/.pi/genesis-tester/sessions/<cwd-slug>/` — inherited from `PI_CODING_AGENT_DIR`; override with `PI_CODING_AGENT_SESSION_DIR` or `--session-dir`
- **Secrets**: `.env` and `auth.json` are live-key copies, both gitignored and untracked. ⚠️ `sessions/` and `state/prompt-capture/` **are tracked** (the `sessions/` line is commented out in `.gitignore`) — contained only by the missing remote
- **Vendored**: `bin/fd` + `bin/rg` (8.8 MB), committed

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
| Installed packages | main agent: pi-web-access 0.44.0, pi-agent-browser-native 0.9.1, pi-agents-pool 0.2.0, @mjakl/pi-subagent 3.1.0, @llblab/pi-telegram 0.58.3 (declared, no bot config here) · chat_meter_web: pi-web-access 0.44.0 (pinned) |
| Enabled models | deepseek-v4-pro, deepseek-flash |
| MCP servers | none |

All settings live in `~/.pi/agent/settings.json`.

---

## Version Control

| What | Where | State |
|---|---|---|
| Main workspace | `/home/pmpmt/.pi` → `neopmpmtj/pi-workspace` (private) | clean on `main`, tracking origin; runtime state (sessions, cron store/runs, prompt-capture, `agent/tmp`, `agent/pi-web-access`, `agent/telegram.json`) gitignored |
| Each skill | `/home/pmpmt/.pi/agent/skills/<name>/` → `neopmpmtj/skill-<name>` (private) | clean on `main`, tracking origin; ignored by `pi-workspace` |
| Partner agent | `/home/pmpmt/.pi/explore-discover` → `neopmpmtj/explore-discover` (public) | clean on `main` |
| genesis-tester (standalone) | `/home/pmpmt/.pi/genesis-tester` | nested local repo, 5 commits, **no remote**; excluded from `pi-workspace` by `~/.pi/.gitignore` |

Clone/update a skill directly at its path:

```bash
git -C ~/.pi/agent/skills/<name> pull     # update
git -C ~/.pi/agent/skills/<name> push     # publish changes
```

Private repos require GitHub auth on any machine you clone them from (SSH key or `gh auth login`).

---

## Replica Hosts

| Host | Role | State |
|---|---|---|
| `neopmpmtj` (100.85.79.17) | Replica of this agent: unattended, driven from Telegram | `~/.pi` is a clone of `pi-workspace`; boot autostart via **user** unit `pi-agent.service` (`~/pi-service/pi-supervisor.sh` → tmux socket `-L pi` → `~/.local/bin/pi`); linger `yes`; bot **@pi_vps_assistant_bot** |

- Same stack as here: nvm node `v24.21.0` → pi `1.4.0` → `~/.local/bin/pi` wrapper sourcing `.env`. The old self-contained `~/bin/pi` + `~/pi/node` launcher is retired; its scaffolding is archived in `~/.pi.archived-20261102`
- Sync either direction with `git -C ~/.pi pull --ff-only` / `push`; the seven skills are cloned there as their own repos
- **Automatic sync on both hosts**: the `~/.local/bin/pi` wrapper pulls `--ff-only` before each top-level start, and `extensions/auto-sync.ts` commits + pushes on shutdown. Subagents do neither; a rejected push is rebased once, then left local with a loud notice
- Machine facts for that host live in its untracked `/home/pmpmt/AGENTS.md`, not in the shared instruction files

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
| `~/.pi/agent/AGENTS.md` | Portable rules: orchestrator role, delegation, skill authoring, subagent troubleshooting (tracked) |
| `~/.pi/agent/APPEND_SYSTEM.md` | Portable rules: secrets, CLI hygiene, working style, downloads, inter-agent comms (tracked) |
| `~/AGENTS.md` | **Machine-local facts** (location, Postgres, remote hosts, tooling) — untracked, loaded as a context file by directory layering |
| `~/.pi/agent/agents/frontend.md` | Front-end sub-agent definition |
| `~/.pi/agent/agents/researcher.md` | Web research sub-agent definition |
| `~/.pi/agent/prompts/*.md` | Custom prompts (`/document`, `/dump`, `/explore-pi`, `/readocs`, `/short`) |
| `~/.pi/agent/skills/<name>/SKILL.md` | The six skills (each a standalone repo) |
| `~/.pi/agent/skills/skill-creator/scripts/quick_validate.py` | Skill frontmatter/spec validator |
| `~/.pi/agent/extensions/{auto-sync,cron,git-commit,secret-scrubber,pi-prompt-capture}.ts` | Custom extensions |
| `~/.pi/agent/extensions/auto-sync.ts` | On `session_shutdown`: stage `~/.pi`, secret-scan the staged diff, commit (`[pi:<host>] <last assistant line>`), push; on rejection rebase once then keep the commit locally. Skips subagents. Also adds `/sync` and `/sync pull` |
| `~/.local/bin/pi` (pre-exec) | Before starting pi: `git -C ~/.pi pull --ff-only`, 120 s debounce, subagent-guarded, never fatal |
| `~/.pi/logs/auto-sync.log` | Auto-sync decisions (pull skips, secret-guard refusals, rebase outcomes) |
| `~/.pi/agent/extensions/observability/index.ts` | Run recording → `runs.jsonl` + `runs.sqlite`; subagent lineage + token rollup views; `/tokens` |
| `~/.pi/.pi/extensions/{pi-event-tracer,session-memory}/index.ts` | Project-local extensions |
| `~/.pi/cron/jobs.json` / `~/.pi/cron/runs/` | Cron job store / run history |
| `~/.pi/agent/partner-agents/partner-agents.list` | Partner agent registry |
| `~/.pi/agent/partner-agents/export-partner-agent.sh` | Build a partner-agent installer |
| `~/.pi/genesis-tester/settings.json` | Standalone `genesis-tester` agent config (no packages, no extensions) |
| `~/.pi/genesis-tester/.env` | Standalone agent's own credentials (sourced by `pi-genesis-tester()`) |
| `~/image-describer/settings.json` | image-describer config: `deepseek-flash`, `describe_images`, describe-images extension |
| `~/image-describer/.env` | image-describer credentials (`DEEPSEEK_API_KEY`, mode 600) — sourced by its launcher |
| `~/image-describer/extensions/describe-images/index.ts` | `/describe-images` command and `describe_images` tool |
| `~/image-describer/README.md` | Setup, flags, model capability table, verification |
| `~/.local/bin/pi-image-describer` | Isolated launcher for the image-describer agent |
| `~/.pi/agents-shared-scripts/session-slim/slim_session.py` | Shared session slimmer; writes readable JSON to `~/.pi/sessions-slim/` |
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
| `observability-token-lineage-setup/` | Delegation-aware token accounting: subagent lineage (`parent_session_id`/`agent_name`/`handle`/`depth`), token views, `/tokens` command, VPS transplant |
| `backup-laptop-tool-setup/` | Laptop backup tool |
| `backup-service-account-oauth-fix/` | Backup OAuth fix |
| `cron-job-system-setup/` | Cron job system |
| `multi-agent-orchestrator-setup/` | Multi-agent orchestrator (current + historical) |
| `separate-pi-instances/` | Running separate Pi instances / workspaces |
| `genesis-tester-standalone-agent/` | Bare standalone agent: `PI_CODING_AGENT_DIR` isolation, session-dir precedence, credential paths, drift/finding analysis |
| `image-describer-creation-report.md` | Minimal read-only sibling agent: isolated launcher + own `.env`, inventory delta vs the main agent, what was left out and how to add it back |
| `skill-stale-commands-fix/` | Skill command fix |
| `speech-to-text-keyboard-shortcut-fix/` | STT keyboard fix |
| `text-to-speech-app-setup/` | Text-to-speech app |
| `gog-workspace-portable-install/` | Portable gog-workspace install (Google Console → pinned binary → keyring transplant → VPS rollout) |
| `yt-download-user-manual.md` | yt-download skill usage |
