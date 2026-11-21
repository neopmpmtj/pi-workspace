# Scripts map

One page that answers "where does a script live and what is it for?". Five homes, on
purpose — but you should never have to guess. Add a row when you add a script (AGTENTS.md
requires it); a script that is not on this page is effectively invisible.

Convention for new names: prefix with the domain (`host-`, `backup-`, `gog-`, `downloads-`),
put shared helpers in `scripts/lib/`, and never leave a helper executable-by-accident.

## 1. `~/.pi/scripts` — host identity, sync, backup

| Script | What it does | Wired to |
| --- | --- | --- |
| `check-host-parity.sh` | 10-row fingerprint table of laptop vs VPS; exits 1 on drift | run by hand, by `sync-hosts.sh`, by the alerts |
| `sync-hosts.sh` | `check` / `pull` / `push` / `setup` for both hosts (fetch-first, submodules, hooks) | run by hand |
| `pre-sync.sh` | debounced `pull --ff-only` at session start; loud when ahead/behind | `~/.local/bin/pi`, `pi-cos-orchestrator-agent` |
| `fingerprint.sh` | prints this host's `KEY=value` fingerprint | `publish-fingerprint.sh`, `parity-alert.sh` |
| `publish-fingerprint.sh` | laptop → VPS fingerprint over ssh (fallback path) | `pre-sync.sh` |
| `parity-alert.sh` | nightly drift check, Telegram card on real drift | `pi-parity-check.timer` (VPS, 09:00) |
| `backup-host-state.sh` | nightly archive of per-host state into `~/pi-host-backups` | `pi-host-backup.timer` (both hosts, 03:30) |
| `update-pi-both-hosts.sh` | `pi update` on both, reinstall pinned packages, restart VPS agent, verify | run by hand |
| `env.sh` | single source for the nvm node path and `PI_REPO` | sourced by every script above |
| `systemd/pi-host-backup.service` + `.timer` | nightly backup unit (03:30, both hosts) | copied to `~/.config/systemd/user` |
| `systemd/pi-parity-check.service` + `.timer` | nightly drift check unit (09:00, VPS) | copied to `~/.config/systemd/user` |
| `protected-paths.txt` | **data, not a script**: what `/archive` must refuse | `agent/src/protected-paths.ts` |
| `check-registers.sh` | fails when a script or runbook is missing from its register | run by hand, `sync-hosts.sh check` |

## 2. `~/.pi/agent/scripts` — agent-side jobs

| Script | What it does |
| --- | --- |
| `gog-token-keepalive.sh` | refreshes the gog token (systemd timer) |
| `gog-keepalive-day8.sh` | one-shot day-8 verdict job for the gog keepalive |
| `downloads-inventory.sh` | lists what the downloads folder holds |
| `downloads-reclaim.sh` | reclaims space from the downloads folder |
| `fetch-publications.ts` | fetches publication lists (`npm run fetch:publications`) |
| `fruit_portrait_svg.py`, `photo_trace_svg.py` | SVG tracing helpers for the svg-photo-convert skill |

## 3. `~/.pi/apps-scripts/` — standalone projects

Eight self-contained projects (`backup_laptop_tool`, `ExplainLike12`, `on-demand-stt-rewrite`,
`text-to-speech`, `svg-scripts`, `archive-to-target-full-tree`, `temp_holding_folder`,
`file-dedupe`). Each keeps its own `.gitignore`, README and tests; they are not agent scripts.
`archive-to-target-full-tree` is what `/archive` runs.

| Project | What it does |
| --- | --- |
| `file-dedupe/` | `dedupe.py` — content-hash duplicate finder (`scan`/`report`/`apply`/`verify`/`restore`/`purge`), quarantine by default, resumable SQLite index, `python3 -m unittest discover -s tests` |

## 4. `~/.pi/agent/skills/*/scripts` — scripted skills

Each skill owns its helpers (e.g. `agent-creator/scripts/scaffold.ts`,
`svg-photo-convert` renderers). Look inside the skill folder before adding a global script.

## 5. `~/.local/bin` — launchers (outside the repo)

| Launcher | Host | Purpose |
| --- | --- | --- |
| `pi` | both | main entry: `.env`, node pin, model defaults, `pre-sync.sh` |
| `pi-cos-orchestrator-agent` | VPS | service launcher used by `pi-vps-agent.service` |
| `pi-config` | both | control-plane CLI (gates, modes, phrases, agent settings) |
| `pi-web-master`, `pi-tasks-agent`, `pi-image-describer`, `pi-sm-google-workspace` | both | sibling launchers |
| `pi-lan-agent`, `pi-explore-discover-pi` | laptop only | laptop-exclusive siblings |

## 6. Documentation that is not a script

| Path | What it holds |
| --- | --- |
| `agent/docs/runbooks/INDEX.md` | index of every runbook (safety → host/sync → topic) |
| `agent/docs/{CHEATSHEET,INBOX,NOTES}.md` | operator cheatsheet, open work, loose notes |
| `docs/pi-state-summary.md` | living map of the whole tree |
| `docs/SCRIPTS.md` | this file |

## Decision: folders or not?

Not yet. Nine executables in `scripts/`, all but two in one family (host identity/sync), and 53
references across the repo point at their current paths — a folder split today buys nothing and
breaks 53 things. Revisit when `scripts/` passes ~15 files: then `host/`, `backup/`,
`maintenance/`, `lib/`, done in one commit with the map updated.
