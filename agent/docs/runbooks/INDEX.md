# Runbooks — start here

One index for everything in this folder. Three groups: **safety** (never archive), **host &
sync** (the two-machine setup), and **topic** runbooks (feature how-to). Every runbook here is
protected from `/archive` — see "Protecting or archiving a doc" at the bottom.

## Safety & recovery — read before deleting anything

| Doc | What it answers |
| --- | --- |
| [what-must-remain.md](what-must-remain.md) | what may never be deleted, in tiers; what the nightly backup covers |
| [host-parity-laptop-vps.md](host-parity-laptop-vps.md) | how the laptop and VPS are kept identical: scripts, hooks, timers, decisions, gotchas |
| [laptop-sshd-tailscale-only.md](laptop-sshd-tailscale-only.md) | the VPS→laptop ssh path (Tailscale-only) that makes the nightly live parity check possible |

## Host, sync & deployment

| Doc | What it answers |
| --- | --- |
| [vps-agent-parity.md](vps-agent-parity.md) | earlier replica notes (superseded by host-parity-laptop-vps.md, kept for history) |
| [vps-telegram-bridge.md](vps-telegram-bridge.md) | the Telegram bridge on the VPS: bot, owner, single-poller rule |
| [pi-config-terminal-toggles.md](pi-config-terminal-toggles.md) | `pi-config` from bash: every gate, mode and phrase |
| [agent-sudo-passwordless.md](agent-sudo-passwordless.md) | passwordless sudo for the agent: the `host-sudo-mode.sh` toggle, why OFF is free and ON costs a password, the narrow-rule and askpass alternatives, actions still handed back to the human |
| [mode-switch.md](mode-switch.md) | the mode-switch hook (1-Personal … 5-Research) |

## Topic runbooks

| Doc | What it answers |
| --- | --- |
| [calendar-routing.md](calendar-routing.md) | calendar node: classify → create event without a chat turn |
| [calendar-routing-on-vps.md](calendar-routing-on-vps.md) | the same routing on the VPS |
| [reminder-routing.md](reminder-routing.md) | reminder node: store vs Google Tasks writer |
| [gog-new-oauth-client.md](gog-new-oauth-client.md) | creating the Google OAuth client |
| [gog-oauth-consent-screen.md](gog-oauth-consent-screen.md) | publishing the consent screen, re-consent chain |
| [gog-add-tasks-scope.md](gog-add-tasks-scope.md) | adding the Tasks scope |
| [gog-token-keepalive.md](gog-token-keepalive.md) | keeping the gog token alive |
| [google-keep-read-all.md](google-keep-read-all.md) | Keep read access |
| [voice-first-accessibility.md](voice-first-accessibility.md) | the agent talks back: one speech seam (`scripts/speech/speak.sh`), per-surface wiring, what changes in reply shape when the user cannot read |
| [lan-python-venv-hotword-cnn.md](lan-python-venv-hotword-cnn.md) | hotword CNN venv on the LAN server |
| [svg-rendering.md](svg-rendering.md) | SVG rendering pipeline |
| [file-dedupe-plan.md](file-dedupe-plan.md) | **active task brief** — content-based duplicate cleaner for the 1 TB USB drive and the two NTFS data disks; plan, decisions, measured disk facts |

## Subfolders

| Folder | Contents |
| --- | --- |
| [lan-server-192.168.1.60/](lan-server-192.168.1.60/index.md) | the LAN box at `192.168.1.60`: ssh keys, file server, pi install, Ollama/RTX 3060, two-server agents. Start at its own `index.md` |

## Elsewhere in `agent/docs/`

| Doc | What it answers |
| --- | --- |
| [CHEATSHEET.md](../CHEATSHEET.md) | operator commands for this agent, one screen |
| [INBOX.md](../INBOX.md) | agreed future work; read when asked "what is next" |
| [NOTES.md](../NOTES.md) | loose notes that have not earned a runbook yet |

Scripts have their own map: `docs/SCRIPTS.md` at the repo root.

## Protecting or archiving a doc

`/archive` refuses every file in this folder (and `agent/docs/*.md` and `docs/*.md`), because
removing durable instructions is exactly the mistake the guard exists to stop. Verified
behaviour:

- `/archive agent/docs/runbooks/<any>.md` → `[FAIL] /archive refuses to move …`
- `/archive agent/docs/runbooks` → refused as a directory containing protected files
- `/archive --dry-run …`, `--list`, `--undo` → always allowed

To archive a genuinely obsolete runbook: delete its line from `~/.pi/scripts/protected-paths.txt`
(or comment it), run `/archive`, then put the line back. The list is the single lever; no code
change is needed.

To add a runbook: create it here and add a row to the matching table above.
