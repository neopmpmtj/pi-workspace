# Partner Agent Tooling

Central management for **partner agents** — separate Pi workspaces (each with
its own `PI_CODING_AGENT_DIR`, identity, and git repo) that the main agent
talks to over `pi --print --session <handle>`.

## Files

| File | Purpose |
|---|---|
| `gitignore.template` | Canonical `.gitignore` copied into every new agent |
| `setup-pi-agent.sh` *(lives in explore-discover)* | Interactive creator: workspace + alias + **git/GitHub backup** |
| `push-partner-agents.sh` | Commits + pushes every agent in the registry (the "update all partners" command) |
| `partner-agents.list` | Registry — one workspace path per line |

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

## Creating a new partner agent

```bash
~/.pi/explore-discover/setup-pi-agent.sh
# → answers prompts → creates workspace + alias + public GitHub repo + push
```

## Syncing all partner agents

```bash
~/.pi/agent/partner-agents/push-partner-agents.sh
```
