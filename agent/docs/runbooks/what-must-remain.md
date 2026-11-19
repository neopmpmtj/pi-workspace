# What must remain

Written for a future cleanup — by you, by another agent, or by someone who does not know
this tree. Rule of thumb: **if it is not in git and not in `~/pi-host-backups`, deleting it
is irreversible.**

Inventory command (regenerates the list below from the live machine):

```bash
bash ~/.pi/scripts/backup-host-state.sh --list
```

## Tier 0 — delete one of these and the agent stops working

| Path | Why |
| --- | --- |
| `~/.pi` (whole tree, `.git` included) | the workspace, the repo, the history |
| `~/.pi/agent/.env` | API keys (`DEEPSEEK_`, `OPENAI_`, `GEMINI_`); the VPS also holds `TELEGRAM_BOT_TOKEN`, gog keyring and backup settings |
| `~/.pi/agent/settings.json` | extensions list, packages, enabled models — wrong/missing means features vanish silently |
| `~/.pi/agent/agent.json`, `AGENTS.md`, `APPEND_SYSTEM.md` | identity, roster, and the rules the model is given every turn |
| `~/.pi/agent/extensions/` | every hook and slash command, auto-discovered |
| `~/.pi/agent/skills/` (+ submodules checked out) | empty dirs = skills gone; needs `git submodule update --init --recursive` |
| `~/.pi/control/`, `~/.pi/decision-nodes/`, `~/.pi/cron/` | `pi-config`, calendar/reminder/intake nodes, cron engine |
| `~/.pi/agent/npm/package.json` + `package-lock.json` + `node_modules/@llblab/pi-telegram` | the Telegram bridge |
| `~/.local/bin/pi` (VPS: `pi-cos-orchestrator-agent`) | the launcher — **outside git**, nothing else provides it |
| VPS only: `~/pi-service/pi-cos-supervisor.sh`, `~/.config/systemd/user/pi-vps-agent.service` | keeps the service alive in tmux |

`~/.pi/agent/auth.json` is `{}` on both hosts today (API keys live in `.env`), so losing it
is harmless.

## Tier 1 — the agent runs, but you lose continuity, parity, or access

| Path | Lost if deleted |
| --- | --- |
| `~/.pi/agent/trust.json` | project trust decisions (re-prompt per project) |
| `~/.pi/agent/telegram.json` | bot profile + owner id (bridge cannot start) |
| `~/.pi/agent/model-rates.json`, `models-store.json`, `default-model.json` | cost card, model catalog cache, per-host model choice |
| `~/.pi/config.json`, `input-phrase-config.json`, `prompt-build-config.json` | active mode/phrase and gate values |
| `~/.pi/cron/jobs.json` | scheduled jobs |
| `~/.pi/decision-nodes/reminder/reminders.jsonl` | per-host reminder history |
| `~/.pi/agent/logs/ledger.sqlite` | `/usage` and the dashboard history |
| `~/.pi/agent/sessions/` | past conversations |
| `~/.pi/.gitignore`, `~/.pi/.githooks/post-merge` | the per-host rules and the pull hook (recoverable from git) |
| `~/pi-host-backups/` | **the only copy of all of the above** — prune old files, never the directory |
| Laptop: `/etc/systemd/system/ssh.socket.d/10-tailscale-only.conf` + `~/.ssh/authorized_keys` | VPS → laptop access, i.e. the nightly live parity check |
| VPS: `~/.ssh/config` (`Host laptop` stanza + `IdentityFile`) | same, from the other side |

## Tier 2 — regenerable, safe to delete

- any `node_modules/` (root `agent/`, `agent/npm/`): `npm install` / `npm ci --omit=dev --legacy-peer-deps`
- `agent/tmp/`, `agent/state/`, `agent/observability/`, `__pycache__/`, `*.log`
- `agent/npm/node_modules/.package-lock.json` (npm rebuilds it)
- submodule checkouts (re-clone with `git submodule update --init --recursive`)
- `~/.cache/pi-workspace-last-pull` (debounce marker)
- old archives inside `~/pi-host-backups/` (keep the newest one at least)
- `~/.pi/agent/auth.json` (empty today)

## Verify after any cleanup

```bash
bash ~/.pi/scripts/check-host-parity.sh     # install facts, both hosts, exits 1 on drift
bash ~/.pi/scripts/backup-host-state.sh     # proves the tier-0/1 files are still readable
```

The backup archive (`~/pi-host-backups/pi-host-<host>-<date>.tar.gz`, mode 600, 14 kept)
contains every tier-0/1 file that is **not** in git: `.env`, bot/trust/model state, ledgers,
reminders, launchers, supervisor, systemd user units, `~/.ssh/config` and
`authorized_keys`. It does not contain private keys, sessions, or `node_modules`.

## Failsafe: /archive refuses these paths

`/archive` cannot move anything on the protected list, nor any **directory containing**
a protected path (so `/archive ~/.pi/agent` is refused as a whole). The list is
`~/.pi/scripts/protected-paths.txt` — one pattern per line, `~`/`*`/`**` supported — read by
`agent/src/protected-paths.ts` before the archive script is spawned.

- refused: normal moves of tier-0/1 paths, including this file
- allowed: `--dry-run` (shows the plan, moves nothing), `--list`, `--undo`
- to protect something new, add a line to `protected-paths.txt`; no code change needed

## Things that look deletable but are not

- `~/.local/bin/pi*` — plain bash wrappers; the system's `pi` binary alone will not load
  `.env`, pin node, or apply the model defaults.
- `~/.pi/.githooks/` — only runs because `git config core.hooksPath .githooks` points at it.
- `decision-nodes/**/verdicts.jsonl`, `review.jsonl` — ignored by git, useful for tuning the
  classifier; not required.
- `~/.pi/agent/npm/node_modules` has exactly **one** package. That is correct, not a broken
  install.
