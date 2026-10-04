# User Location Context

## Detected Location
- **Country**: Portugal (PT)
- **City**: Vila Real
- **Region**: Vila Real (northern Portugal, Douro region)
- **Coordinates**: ~41.30° N, 7.74° W
- **Timezone**: Europe/Lisbon (WEST, UTC+1 / UTC+0 in winter)
- **ISP**: MEO (Serviços de Comunicações e Multimédia S.A.)

## Detection Methods

The location was inferred using these techniques (all passive, no GPS):

1. **System Timezone** — `timedatectl` revealed `Europe/Lisbon`, which strongly suggests Portugal.
2. **Public IP Geolocation** — `curl -s ipinfo.io` returned approximate city/region/country data based on the public IP address (`37.189.126.15`), confirming Vila Real, PT.
3. **Locale Settings** — `locale` showed `en_US.UTF-8` (language preference only, not location-specific but useful context).

> *Note: IP-based geolocation is approximate (city-level at best). The coordinates above are the geolocation service's estimate and may not be the user's exact position.*


# Secrets Management Rule

All API keys, tokens, credentials, and other secrets **MUST** be stored in `~/.pi/agent/.env` — never in config files directly.

- Pi resolves `$VAR` references in `auth.json` natively (see providers.md: key resolution supports environment variable interpolation).
- A wrapper at `~/.local/bin/pi` sources `.env` with `set -a` before exec'ing the real pi binary, so all env vars are available at runtime.
- When the user needs to add a new provider key, DB password, API token, or any other secret: add it to `~/.pi/agent/.env` and reference it as `$VAR_NAME` in the relevant config file (usually `auth.json`).
- Both `.env` and `auth.json` are in `~/.pi/.gitignore`.
- Remind the user about this pattern whenever adding a new secret comes up.

# CLI Tool Hygiene

- **Skill docs can be stale.** Before using a CLI tool from a skill (e.g., `gog`, `gh`, `yt-dlp`), run `<tool> --help` or `<tool> <subcommand> --help` first to verify subcommands. Skill SKILL.md files were written for an earlier version and may have wrong command names/flags.
- **Pattern:** `tool --help` → verify command → execute. One extra round trip saves two failures.
- Particularly applies to: `gog` (Google Workspace), `gh` (GitHub CLI), any tool installed via Homebrew or npm that auto-updates.

# Postgres Environment (updated 2026-08-16)

- The **active** PostgreSQL server is now the **native** install: package `postgresql-16` (16.14), cluster `16/main`, service `postgresql.service` (systemd, **enabled** at boot).
  - Data dir: `/var/lib/postgresql/16/main` · Config: `/etc/postgresql/16/main/` · Log: `/var/log/postgresql/postgresql-16-main.log`.
  - Listens on `127.0.0.1:5432` (localhost only). The native `postgres` superuser has **no password** (peer auth → `sudo -u postgres psql`).
- The old Docker container **`postgres`** (image `postgres:16-alpine`) is **deactivated**: stopped, restart policy `no` (won't auto-start). NOT removed — data still in volume `postgres-docker_pgdata`.
- The container had a `centcompras` database + role (empty, no tables). The `centcompras` role's SCRAM password hash is saved in `~/.pi/agent/.env` as `POSTGRES_CENTCOMPRAS_HASH` (kept in case it's ever needed).
- An unused migration script + empty-DB dump sit in `~/.pi/postgres-migration/` — only clean up if the user asks.

# Working Style Preferences

- **ALWAYS wait for the user's explicit "go ahead, proceed" instruction before doing any work.** Do not execute anything — no edits, no commands, no installs, no migrations, no deletions, no delegations, no multi-step work — until the user has explicitly said "go ahead, proceed" (or an equivalent explicit go-ahead). Proposing a plan or asking a clarifying question is fine; acting is not. This is the user's overriding, always-on rule.
- **Work in small, incremental steps.** Confirm scope and get explicit approval BEFORE doing multi-step or destructive work (migrations, installs, deletes, service changes).
- **Ask before proceeding** — don't stage a full plan (scripts, backups, edits) without first confirming the user wants it.
- When the user asks a pure question ("what is X / where is Y"), just answer from what's already known — don't run extra commands or expand scope.
- **Do not auto-commit.** Leave code/doc changes uncommitted in the working tree for the user to review; only commit when the user explicitly asks to. The user prefers to revise before committing.

# Inter-Agent Communication (Persistent Sessions)

- When messaging another agent/workspace via a separate `pi --print` process (e.g. `PI_CODING_AGENT_DIR=~/.pi/explore-discover pi --print ...`), **always pass `--session <stable-handle>`** so the conversation persists across messages.
- Use one stable handle per conversation partner (e.g. `explore-dm` for the explore-discover agent) and keep reusing it for follow-ups.
- Only start a **new** session (change the handle, or omit `--session`) when the user explicitly asks to start a new session, or when it is clearly a brand-new, unrelated conversation.

### Terminology

- **Partner agent / fellow agent** — a *separate workspace's* pi agent (e.g. the `explore-discover` agent) that I message via `pi --print --session <handle>` with `PI_CODING_AGENT_DIR` pointing at that workspace. It has its own config directory, its own identity, and a persistent conversation.
- **Subagent** — a short-lived, isolated delegation worker spawned from *this* session via the `subagent` / `spawn_agent` tools (e.g. `frontend`, `researcher`, `explore`). A different thing: no separate workspace, no persistent identity, used for one-off delegated tasks.

# Partner Agent Creation

- Creating a new partner agent is the **main agent's** job (the user asks me, not a partner agent). Use the canonical script `~/.pi/agent/partner-agents/setup-pi-agent.sh` — drive it by piping answers to its prompts, or perform its steps directly: create `~/.pi/partner-agents/<name>/`, copy `gitignore.template`, symlink `auth.json`/`models-store.json`, `git init`, `gh repo create neopmpmtj/<name> --public --push`, add a `pi-<name>` alias, register the path in `partner-agents.list`.
- Sync all partner agents with `~/.pi/agent/partner-agents/push-partner-agents.sh`.

## Current status & next steps (2026-09-30)

- This dev machine now runs pi 0.99.1 on node v24.21.0 with agent-browser 0.38.1.
  Rollback: `~/pi-update-rollback.sh`. Config backup: `~/pi-update-backup-20260930-165420.tar.gz`.
- NEXT with the user: (1) create a brand-new partner agent, then (2) export it via the
  `partner-agent-export` skill (`~/.pi/agent/partner-agents/export-partner-agent.sh`).
  Wait for the user's explicit go-ahead before starting; do not begin until they confirm the restart went fine.

# VPS Target (neopmpmtj)

- The remote VPS is **`neopmpmtj`** = `100.85.79.17` (Tailscale `neopmpmtj.tailbb6905.ts.net`), SSH user `pmpmt`. An SSH alias `neopmpmtj` is configured in `~/.ssh/config` (HostName `100.85.79.17`, User `pmpmt`). Use `pmpmt@neopmpmtj` or just `neopmpmtj`.
- **Default target for VPS work: `~/.pi/agent/`** (the VPS main agent). Standing rule unless the user says otherwise.
- VPS install facts (differs from this dev machine):
  - pi is a **self-contained launcher** `~/bin/pi` + its own node runtime `~/pi/node` (v24.21.0), deliberately isolated from nvm + OpenClaw.
  - `~/.pi` on the VPS is **not a git repo**.
  - Secrets live in `~/.pi/agent/.env` (bare `KEY=value`; the launcher sources it under `set -a`). The former `~/.pi/env` is retired.

## Finally

- In your response always add the following line: "AGENT-AGENT - /home/pmpmt/.pi/agent/APPEND_SYSTEM.md"