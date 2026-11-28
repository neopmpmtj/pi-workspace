# Inbox — done

Every closed item from `INBOX.md`, one line each: the date it closed, what it was, and the
closing fact with where the proof lives. `INBOX.md` holds open work only.

The original wording is never lost: it is in the git history of `INBOX.md` (the split itself is
a commit), and in the runbook, log or commit named on the line. "Closed without work" means the
item died with a change elsewhere — record it and move on, do not reopen it.

## sm-google-workspace

- 2026-11-28 — `--limit N` on the list-shaped canned commands → `/inbox-new [--hours N] [--limit N]` and `/gdrive-root [--limit N]`; default 20 rows, `--limit 0` prints all, one trailing line counts the rest. Proof: sibling `test/gog.test.ts` 120/120, commit `40cb588`.
- 2026-11-01 — Keyring passphrase is current → that repo keeps its own `.env` (mode 600) with `GOG_ACCOUNT` and `GOG_KEYRING_PASSWORD`; `gog` answers through the launcher.

## This agent

- 2026-11-02 — `gpt-6.1-sol` enabled with no `OPENAI_API_KEY` → key placed; a live call answers, no `auth.json` entry needed because the launcher exports it.

## VPS `neopmpmtj`

- 2026-11-28 — Dead `GEMINI_API_KEY` in the VPS `.env` → the `AQ.…` key is gone, but its `AIza…` replacement is rejected too; closed by dropping both `gemini-*` models from `enabledModels`, not by finding a key.
- 2026-11-04 — Telegram ownership → decided: the VPS keeps the bridge, the laptop is TUI-only and holds no token.
- 2026-11-28 — "VPS enablement as found 2026-11-04" (clone behind, `gog` not installed, `TYPESAFE_API_KEY` missing) → all three resolved: the clone is synced at the same HEAD, `gog` is symlinked at `~/.local/bin/gog`, `TYPESAFE_API_KEY` is present, and `calendarNode` is enabled.

## lan-agent

- 2025-11-03 — Real server address → `192.168.1.60`, Ubuntu 24.04, OpenSSH 9.6p1, port 22.
- 2025-11-03 — `user: pistore` and `remoteRoot: /srv/pi-storage` → both live, `check` READY, 50 MB round trip byte-identical; `AllowUsers` was the blocker.
- 2026-11-28 — `config/storage.json` pinned to `pistore:` → repointed to `pmpmt` / `/home/pmpmt/storage` after the 2026-11-23 reinstall.
- 2026-11-28 — `/srv/pi-storage` on the root filesystem → **closed without work**: the path no longer exists; the box is one 1 TB NVMe.
- 2026-11-28 — Server sshd allows password auth → **merged** with the `pmpmt` twin into one open item (flip to key-only once the key has settled).
- 2026-11-28 — Reserve `192.168.1.60` in the router → static on `eno1` since 2026-11-23.
- 2026-11-28 — "Human step outstanding on the server" (unprivileged user, key, data disk, sshd) → **closed without work**: the reinstall left `pmpmt` as the only user, its key is installed, and there is no separate data disk to mount.

## LAN server as a work machine (agreed 2025-11-03)

- 2025-11-03 — `piadmin` admin identity → rejected; `pistore` got blanket `NOPASSWD` instead (both died with the reinstall).
- 2025-11-03 — Where bulk storage lives → `pistore:/home/pistore/storage` on `nvme0n1p7`, verified by `check` and a round trip (superseded by the reinstall).
- 2025-11-03 — Inventory before moving → `docs/inventory/2026-11-03-home-pmpmt.md`: 42 GB, 14 GB user data, 17 GB dev caches, 13.7 GB stale installers.
- 2025-11-03 — Install pi on the server → pi 1.4.0 on node v24.22.2, `~/.local/bin/pi`, PATH blocks; that stack was replaced after the reinstall.
- 2025-11-03 — Server agent's model → API keys now, local model later (decision).
- 2025-11-08 — Server pi homes → `cloud` and `ollama`, each with launcher, `.env`, ledger, `/ask` and `/usage`; the laptop-side shim is still open in the inbox.
- 2026-11-28 — Batch A (move 55 files / 13.7 GB) → **closed without work**: `pistore` died with the reinstall and the data was rescued to the laptop beforehand.
- 2026-11-28 — Batch B (labels for the archive) → **closed without work**, same reason.
- 2026-11-28 — RTX 3060 present but `nvidia-smi` unreachable → driver answers now: RTX 3060, 12288 MiB; Ollama installed 2026-11-23.
- 2026-11-28 — Server `cloud` agent's invalid `GEMINI_API_KEY` → closed with the model removal: `agent-cloud/cloud/settings.json` no longer offers `gemini-*`.
- 2026-11-28 — "Safeguards: re-scope `piadmin` sudo" → **closed without work**: no `piadmin` exists; `pmpmt` has `NOPASSWD` and the box is single-user.

## Group rename, left open

- 2026-11-01 — GitHub repo still `gog-worksapce-agents` → renamed; `.gitmodules`, the parent `.git/config` and the submodule origin all point at `gog-workspace-agents.git`.
- 2026-11-28 — Archived tree kept the old spelling → renamed to `gog-workspace-agents`; nothing tracked pointed at the old path.

## Calendar routing (first live node, 2026-11-04)

- 2026-11-04 — Classify and route a definite calendar entry → live node + hook; walkthrough in `~/.pi/decision-nodes/calendar/README.md`.
- 2026-11-04 — Fill `do:calendar:create` → chained FREE/BUSY → one `deepseek-flash` JSON call → validated → `gog calendar create`; verified live by creating and deleting an event.
- 2026-11-04 — Canned calendar read → `do:calendar:gog` runs `gog calendar freebusy` in ~0.3 s, no tokens.
- 2026-11-04 — Decide whether a match swallows the turn → local surfaces swallow it (trace and outcome printed, no session entry); Telegram relays.
- 2026-11-04 — Telegram relay turn → the outcome goes out through the bridge's delivery API; a failed delivery falls back to relaying.
- 2026-11-04 — Which pi home owns Telegram → the VPS keeps the bridge; the laptop runs no bot.
- 2026-11-05 — Attendees, reminders and recurrence → the extractor returns emails, `popup:30m`/`email:1d` and one `FREQ=` rule; the write passes `--attendees`, `--reminder`, `--rrule`.
- 2026-11-05 — Telegram on this laptop → decided: not used; the laptop item is not open work.

## Next decision nodes (agreed 2026-11-05)

- 2026-11-05 — `classes/__init__.py` loads every module → done with the `reminder`, `reminder_done` and `vetoes` modules.
- 2026-11-28 — "A new decision node lives in `decision-nodes/<name>/` and reads its own slice" → moved to `AGENTS.md` → "Decision nodes: two standing rules" (it was a rule, not a task).
- 2026-11-28 — "`classes/calendar.py` stays one file" → same home in `AGENTS.md`; nothing to build until its questions stop fitting.

## Reminder routing on this host (found 2026-11-06)

- 2026-11-06 — Classifier missing here, so the hooks always failed open → cloned at the pinned gitlink `6b43d6d`, `TYPESAFE_API_KEY` placed; live `act` 0.99 checks passed.
- 2026-11-06 — `reminders.jsonl` untracked here → tracked in commit `0d38b4a`; `.gitattributes` carries `merge=union`.

## Reminder destinations: calendar, Keep, fallback (2026-11-06)

- 2026-11-06 — `reminderNode.calendar: false` gated only the event → corrected: `reminderNode.writes: false` routes nothing at all.
- 2026-11-07 — Three destinations (event, Keep, fallback) → replaced by one exclusive `reminderNode.writer`: `store`, `tasks` or `off`. Keep is gone.
- 2026-11-07 — keep-agent → removed with keep-cli; will not return (no home, no roster row, no `:8790` unit, no launcher).

## tasks-agent (2026-11-07)

- 2026-11-07 — Lean `tasks-agent` sibling → launcher `pi-tasks-agent`, dashboard `:8791`, Google Tasks via `gog tasks`, contract in `docs/CALLING.md`.

## Google Keep via `keep-cli` (2026-11-06)

- 2026-11-06 — `--read-all-items` → shipped as keep-agent's tool, removed 2026-11-07 with that agent (runbook kept as history).
- 2026-11-06 — Create notes and lists, bin and restore → shipped 2026-11-06; removed with keep-cli.
- 2026-11-06 — Edit rows in place (append, tick, untick) → shipped 2026-11-06; removed with keep-cli.
- 2026-11-07 — Telegram `keep:` capture, morning brief, Sunday reset, write-back sinks, Keep search, Tasks bridge → all cancelled 2026-11-07 with keep-cli; do not restore.

## VPS parity (2026-11-06)

- 2026-11-06 — "Orphan pi owns Telegram polling" → diagnosis was wrong: `pi-cos.service` owned it all along; enabling `pi-agent.service` produced two pollers for ~45 s and was undone. Lesson in `runbooks/vps-agent-parity.md`.
- 2026-11-07 — keep-agent units on the VPS → cancelled with keep-cli.

## Agent home restore & rename audit (2026-11-06)

- 2026-11-06 — `/archive` moved the live home and reached a pushed commit → restored 66 files from `8755ed5` (63/63 byte-identical), ledger and `events.log` from the archive, `node_modules` rebuilt, VPS migrated.
- 2026-11-06 — Laptop `.env` still held the bot token → removed; the laptop is TUI-only, `pi-telegram` fails closed, no other `.env` holds a token.
- 2026-11-06 — gog-token-keepalive broken on both hosts → tracked script, tracked unit path; real runs report success (probe ~530–615 ms), alarm only on failure.
- 2026-11-06 — "Two cron jobs overdue" → wrong: `recomputeAllNextRuns()` writes the next *future* occurrence, so they only ran while pi was open; the backup job was later removed.
- 2026-11-28 — Laptop `Linger=no` → `Linger=yes` (enabled 2026-11-28), so the user timers fire with nobody logged in.
- 2026-11-28 — gog day-8 verdict ping → it never arrived because the timer was never installed (no log, no unit). Ran by hand on the VPS after a dry-run: verdict **OK**, token 9 days old, message delivered, VPS keepalive timer disabled. Units now tracked at `scripts/systemd/gog-keepalive-day8.{service,timer}`.
- 2026-11-28 — Verify the first live Telegram turn and `/usage` → both in daily use since the restart.
- 2026-11-28 — Delete `~/.pi/agent#copy/` → gone.
- 2026-11-28 — Prune `~/.pi/z.old` → removed, 126 MB freed (it was gitignored and untracked; `df` on `/home` 279 G free).
- 2026-11-28 — "The bare `pi` wrapper has no effect on a minimal PATH" → fixed twice over: `~/.config/environment.d/10-pi-path.conf` puts `~/.local/bin` and the nvm bin in the `systemd --user` environment (`show-environment` confirms), and `~/.bashrc` exports `~/.local/bin` first **before** the non-interactive guard and again after nvm init, so nvm can no longer shadow the wrapper.
- 2026-11-28 — "The pre-start pull duplicates `auto-sync`" → decided: keep both, one reads at session start and one writes at session end; recorded in `docs/pi-state-summary.md` → "Sync: one writer each, on purpose".
- 2026-11-28 — The server's static `gho_` GitHub credential → the 2026-11-23 reinstall had wiped `gh`, `~/.config/gh` and the credential helper. Redone without sudo (the laptop's static gh binary copied over, token piped through `gh auth login --with-token`, `setup-git`), verified by cloning the private `pi-workspace` and a `push --dry-run`. Runbook has the three commands.

## Launcher audit (2026-11-18)

- 2026-11-08 — Server git/GitHub: clone over SSH works, push does not → route B: `gho_` token in the server keyring, `gh auth setup-git`, `insteadOf` removed; clone and `push --dry-run` verified from a shell and a `pi-cloud` tool call.

## Home flattened into `~/.pi/agent` (2026-11-18)

- 2026-11-18 — Nested `agent/cos-orchestrator-agent` home merged move-only → leftovers in `~/pi-migration-leftovers-20261118/`.
- 2026-11-18 — Renamed `pi-cos.service` → `pi-vps-agent` → done; supervisor, tmux socket/session and launcher keep their names.
- 2026-11-28 — The two invalid `GEMINI_API_KEY`s → all three copies answer `400 API key not valid`; closed by removing the `gemini-*` models everywhere that key would have served.

## Voice-first access (from 2026-11-25)

- 2026-11-25 — Laptop TUI speech → `agent/extensions/speech-reply.ts`, enabled by `PI_SPEECH_TUI=1` in `~/.config/pi-speech.env`; runbook `voice-first-accessibility.md`.

## Closed at the owner's request (2026-11-28)

- 2026-11-28 — Voice **input** on Telegram (local Whisper) → not wanted: typing is good enough today. Reopen only if that changes.
- 2026-11-28 — Desktop screen reader (Orca + `spd-say`) → not wanted for now; pi's own speech covers the reading that matters.
- 2026-11-28 — `setup-host.sh` on the home server (piper voice) → not wanted: the box is not a chat surface and has no pi home.
