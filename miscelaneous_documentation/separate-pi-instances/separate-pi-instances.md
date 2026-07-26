# Separate Pi Instances — Setup & Reference

**Date:** 2026-07-26
**System:** Ubuntu 24.04 (Pi v0.81.1)

---

## Problem

By default, Pi always uses `~/.pi/agent/` as its global config directory. This means every session loads the same `AGENTS.md`, `APPEND_SYSTEM.md`, extensions, and prompts. The orchestrator AGENTS.md says "You are the Orchestrator — delegate, don't execute." That conflicts with wanting a separate agent persona (e.g., a tutor) that needs its own role and instructions.

---

## Solution: `PI_CODING_AGENT_DIR`

The environment variable `PI_CODING_AGENT_DIR` overrides the global config directory. When set, Pi loads its AGENTS.md, settings, extensions, sessions, and prompts from that directory instead of `~/.pi/agent/`.

### What's loaded

| | Normal `pi` | `PI_CODING_AGENT_DIR=~/.pi/explore-discover pi` |
|---|---|---|
| **AGENTS.md** | `~/.pi/agent/AGENTS.md` | `~/.pi/explore-discover/AGENTS.md` |
| **APPEND_SYSTEM.md** | `~/.pi/agent/APPEND_SYSTEM.md` | Only if it exists in the target dir |
| **Extensions** | `~/.pi/agent/extensions/` | `<target>/extensions/` |
| **Prompts** | `~/.pi/agent/prompts/` | `<target>/prompts/` |
| **Settings** | `~/.pi/agent/settings.json` | `<target>/settings.json` |
| **Sessions** | `~/.pi/agent/sessions/` | `<target>/sessions/` (auto-created) |

### What's shared

Auth (`auth.json`) and model store (`models-store.json`) are symlinked from the target directory to `~/.pi/agent/` — both instances use the same API keys.

---

## Current Instances

| Instance | Command | Config dir | Role |
|----------|---------|-----------|------|
| **Orchestrator** | `pi` | `~/.pi/agent/` | Coordinate and delegate |
| **Explore-Discover** | `pi-explore` | `~/.pi/explore-discover/` | Pi internals tutor |

### Bash aliases (`~/.bashrc`)

```bash
# Orchestrator
pi() {
    set -a
    source ~/.pi/agent/.env
    set +a
    command pi "$@"
}

# Explore-discover tutor
pi-explore() {
    set -a
    source ~/.pi/agent/.env
    set +a
    PI_CODING_AGENT_DIR=~/.pi/explore-discover command pi "$@"
}
```

Both source `~/.pi/agent/.env` for API keys, then `pi-explore` overrides the config directory.

---

## Explore-Discover Instance Structure

```
~/.pi/explore-discover/
├── AGENTS.md              ← Tutor role + curriculum
├── settings.json          ← DeepSeek v4 Pro, dark theme
├── auth.json              → symlink to ~/.pi/agent/auth.json
├── models-store.json      → symlink to ~/.pi/agent/models-store.json
├── prompts/               ← Empty (uses /explore-pi from main agent/prompts/)
└── sessions/              ← Isolated session history
```

---

## How to Add More Instances

1. Create the directory: `mkdir -p ~/.pi/<name>/{sessions,prompts}`
2. Create `AGENTS.md` with the agent's role
3. Create `settings.json` (model, theme, etc.)
4. Symlink auth: `ln -s ~/.pi/agent/auth.json ~/.pi/<name>/auth.json`
5. Add bash alias: `PI_CODING_AGENT_DIR=~/.pi/<name> command pi "$@"`

No installation needed. Each instance is just a directory with config files.

---

## Files Created/Modified

| File | Action |
|------|--------|
| `~/.pi/explore-discover/AGENTS.md` | Created — tutor persona + curriculum |
| `~/.pi/explore-discover/settings.json` | Created — DeepSeek v4 Pro |
| `~/.pi/explore-discover/auth.json` | Symlink → agent/auth.json |
| `~/.pi/explore-discover/models-store.json` | Symlink → agent/models-store.json |
| `~/.bashrc` | Updated — `pi-fe` replaced with `pi-explore` |
