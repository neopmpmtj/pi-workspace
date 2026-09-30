# Partner Agent Tooling

Central management for **partner agents** — separate Pi workspaces (each with
its own `PI_CODING_AGENT_DIR`, identity, and git repo) that the main agent
talks to over `pi --print --session <handle>`.

## Files

| File | Purpose |
|---|---|
| `gitignore.template` | Canonical `.gitignore` copied into every new agent |
| `setup-pi-agent.sh` | Interactive creator: workspace + alias + **git/GitHub backup** (lives here, in the central tooling) |
| `push-partner-agents.sh` | Commits + pushes every agent in the registry (the "update all partners" command) |
| `partner-agents.list` | Registry — one workspace path per line |
| `shared/` | Canonical shared resources: `extensions/core/` (every agent), `extensions/optional/` (opt-in), `prompts/`, `session-summarizer/` |

## Conventions

- **Agents live in** `~/.pi/partner-agents/<name>/` (grouped; the whole folder
  is git-ignored by the parent `~/.pi` repo — each agent is its **own** repo).
- **Repos are public** on GitHub: `neopmpmtj/<name>`.
- **Secrets never enter the repo:** `auth.json` and `models-store.json` are
  symlinks → `~/.pi/agent/`, and `.env` is git-ignored.
- **Local state stays local:** `sessions/`, `session-summaries/`,
  `sessions-memory/`, `npm/`, `bin/`, logs — all ignored.
- **Backed up instead:** `AGENTS.md`, `APPEND_SYSTEM.md`, `prompts/`,
  `extensions/`, `.pi/` config, `documented_lessons/`, `session-summarizer/`
  code, `settings.json`, `trust.json`, `web-search.json`.
- **Shared extensions are tiered:** `shared/extensions/core/` is copied to every
  new agent; `shared/extensions/optional/` is copied only when the
  "Copy optional extensions?" prompt is answered yes; `shared/prompts/` and
  `shared/session-summarizer/` hold the shared prompt + memory-pipeline code.
  This is the single source of truth — new agents do NOT depend on
  explore-discover.

## Creating a new partner agent

This is the **main agent's** job (ask the main agent, not a partner agent):

```bash
~/.pi/agent/partner-agents/setup-pi-agent.sh
# → answers prompts → creates workspace + alias + public GitHub repo + push
```

### Path templating

Shared assets are templates, never runnable in place. `setup-pi-agent.sh`
substitutes `__AGENT_DIR__` with the new agent's absolute workspace path when it
copies:

| Template | Placeholder |
|---|---|
| `prompts/document.md` | `__AGENT_DIR__/documented_lessons/` |
| `session-summarizer/summarizer-config.json` | `summariesPath`, `outputPath` |

It also pins `extensions/session-memory.ts` to the agent's own snapshot inbox
(the shared default would resolve to the parent of a grouped agent), and copies
the summarizer to `<agent>/session-summarizer/` so it is tracked by the agent's
repo while its `summarizer-state.json` / `summarizer.log` stay ignored.

Per-agent memory layout: `<agent>/session-summaries/` (raw snapshots) →
`<agent>/sessions-memory/` (curated summaries). Both are git-ignored.

## Syncing all partner agents

```bash
~/.pi/agent/partner-agents/push-partner-agents.sh
```
