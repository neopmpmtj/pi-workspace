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
| `serve-site.sh` | runs the project site (`control/server.ts`, 127.0.0.1:8786) with the same node the launcher uses; needed because a systemd unit has no nvm | `pi-site.service`, or by hand |
| `systemd/pi-site.service` | the site as a user unit (both hosts, `WantedBy=default.target`) | copied to `~/.config/systemd/user`, `enable --now` |
| `systemd/gog-keepalive-day8.service`, `systemd/gog-keepalive-day8.timer` | the one-shot day-8 gog verdict (script in `agent/scripts/`); edit `OnCalendar` per re-consent | copied to `~/.config/systemd/user` only when a fresh consent needs the check |
| `systemd/pi-host-backup.service` + `.timer` | nightly backup unit (03:30, both hosts) | copied to `~/.config/systemd/user` |
| `systemd/pi-parity-check.service` + `.timer` | nightly drift check unit (09:00, VPS) | copied to `~/.config/systemd/user` |
| `systemd/deepseek-credit-monitor.service` | oneshot DeepSeek credit check (free endpoint, Telegram alert on threshold) | `deepseek-credit-monitor.timer` |
| `systemd/deepseek-credit-monitor.timer` | every 30 min (`*:0/30`, Persistent) | copied to `~/.config/systemd/user` (VPS, enabled) |
| `protected-paths.txt` | **data, not a script**: what `/archive` must refuse | `agent/src/protected-paths.ts` |
| `check-registers.sh` | fails when a script or runbook is missing from its register | run by hand, `sync-hosts.sh check` |
| `host-sudo-mode.sh` | `status`/`on`/`off` for passwordless sudo: installs `/etc/sudoers.d/90-pi-agent` (validated with `visudo -cf` first), parks the rule on `off` | run by hand; see `agent/docs/runbooks/agent-sudo-passwordless.md` |

## 2. `~/.pi/agent/scripts` — agent-side jobs

| Script | What it does |
| --- | --- |
| `gog-token-keepalive.sh` | refreshes the gog token (systemd timer) |
| `gog-keepalive-day8.sh` | one-shot day-8 verdict job for the gog keepalive |
| `downloads-inventory.sh` | lists what the downloads folder holds |
| `downloads-reclaim.sh` | reclaims space from the downloads folder |
| `fetch-publications.ts` | fetches publication lists (`npm run fetch:publications`) |
| `deepseek-balance.sh` | DeepSeek credit: one-line balance, `--json`, `--min N` (exit 4 below threshold), `--quiet`; key from `$DEEPSEEK_API_KEY` or the agent `.env`, never printed |
| `speech/host-toggle.sh` | `status` / `set tui\|telegram on\|off`: this host's speech switches as one JSON line, with the rules from `agent/src/speech-switch.ts`; the project site calls it locally and over ssh |
| `gpu/gen.py` | server side of `gpu-image.sh`: builds the ComfyUI graph (turbo or base Qwen-Image-2.1), posts it, moves the PNG to `--out`; deployed to `~/ComfyUI/gen.py` on the home server |
| `gpu-image.sh` | one image on the home server's RTX 3060: `--mode quick\|medium\|max` (SDXL-Turbo 4 steps / Qwen-Image-2.1 base 1024²·20 steps / 2048²·30 steps), `--size N` exact square, prints path + `time= seed=` line, logs to `agent/logs/image-runs.jsonl` |
| `deepseek-credit-monitor.sh` | 30-minute alarm with hysteresis: warn < USD 2.50 once, repeat < USD 2.00 every run, recovery line, error once; sends via Bot API (no model, no tokens); `--dry-run`, `--force`, `--self-test` |
| `speech/speak.sh` | **the one TTS seam**: text on stdin → `.ogg/.opus` (or `.wav`), engine `piper` → `espeak-ng`, `--play` for laptop speakers, exit 5 without audio when a one-shot text-only flag is armed. Every surface calls this, nothing else calls piper directly |
| `speech/print-to-screen.sh` | arms exactly one text-only reply (`tmp/voice-textonly.flag`, epoch seconds): `speak.sh` then exits 5, so Telegram sends the visible text instead of the voice note. Run it in the same turn when the user asks to print/show on screen |
| `speech/clean.py` | markdown → speakable text (drops code fences, URLs, tables, emoji; caps length) |
| `speech/setup-host.sh` | idempotent per-host setup: piper venv, voices, `~/.config/pi-speech.env`, Telegram `outboundHandlers` voice wiring, self-test |
| `wakeword/listen.py` | live "Hey Pamela" detector for the TUI: openWakeWord ONNX, 80 ms frames, prints `READY` / `TRIGGER` / `STOPPED`; no audio written (model + venv stay in `~/python/261114-VAD-openWakeWord/vad-openwakeword`) |
| `wakeword/wakewordctl` | **the one control seam** for the listener: `on`/`off` (persist `enabled`) · `start`/`stop` · `stop-if-owner` · `restart` · `status` · `test`; owns the pidfile and log |
| `wakeword/tone1.wav` | the detection cue played by `/wakeword test` and by `extensions/wakeword.ts` |
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
