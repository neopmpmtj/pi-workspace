# Inbox: agreed future work

Open work only. One item per block, newest at the bottom of its section. When an item ships,
**move it out**: delete it here and add one compressed line to `INBOX-DONE.md` (date, what,
closing fact, proof path or commit) in the same edit. Nothing closed, ticked or struck stays in
this file — it is read on almost every turn and history costs context. The full original wording
is recoverable from the git history of this file.

## lan-agent · server sshd

- [ ] Flip the server's sshd to key-only. **Merged 2026-11-28** from the two `PasswordAuthentication yes`
      items (`pistore` and `pmpmt`): after the reinstall only `pmpmt` exists. `sshd_config` has no
      explicit `PasswordAuthentication` line (default yes), no drop-ins. Prerequisite: prove the
      laptop key works over a fresh session, then `PasswordAuthentication no` + reload.
      Runbook: `docs/runbooks/lan-server-192.168.1.60/lan-file-server-ssh-setup.md`.

## LAN server as a work machine (agreed 2025-11-03)

- [ ] Laptop-side shim so CoS can delegate to `pi-cloud` / `pi-ollama` on `.60` (an `ssh`-based
      launcher keeps the roster unchanged). Not built — found them remote-only for now.
- [ ] Server agents: no OAuth credential exists in this tree (every `auth.json` is `api_key`). If a
      provider should be used through OAuth, run `/login` on the server interactively — one human
      step, not scriptable.

## JEV

- Current state of the classifiers: `~/.pi/docs/pi-state-of-jev.md`.

## Calendar routing

- [ ] **On hold.** The duplicate guard matches titles only; a second phrasing of the same event
      ("Dinner with Rita" vs "Rita dinner") is not caught. Leave the title check as it is.
      Matching on the window, or on title similarity, waits.

## Skills

- [ ] `svg-photo-convert` (created 2026-11-04) was **self-tested only**: this agent has no
      subagent tool and no `claude` CLI, so the four prompts in
      `skills/svg-photo-convert/evals/evals.json` never ran as with-skill/baseline pairs, and
      the description was not optimised against trigger queries. Both need a harness with
      subagents; the measured self-test results are in `evals/README.md`.

## Reminder routing

- [ ] The classifier misses the natural "done" phrasing: "I have taken the tablet" came back
      `reminder_done` 0.22 with `winner: none`, vetoed by `is_past_report`, so the done-route
      never fired and `route.py --done r-20261106-c42b` had to be called by hand. The rules in
      `~/.pi/jev-classifier/jev-classifier-multi/src/classes/reminder*.py` score a bare
      past-tense completion too low; `is_past_report` is meant to veto a *calendar entry*, not a
      reminder close. Re-file the message with `/jev-wrong reminder_done` and add it to the
      golden set before tuning.

## Agent state, launch and backup

- [ ] **Parked: the laptop backup — blocked on credentials.** Checked 2026-11-28: the system unit
      `/etc/systemd/system/my_PC_backup.{service,timer}` is installed and the timer enabled, but
      **all 15 runs since 2026-10-27 failed**, every one with
      `GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in ~/.pi/agent/.env`. No live file
      holds that pair and `gdrive_token.json` does not exist. The unit defects are fixed in the
      tracked copy (`WantedBy=default.target`, no `User=`). Owner's choice: (a) mint a Google OAuth
      client (drive.file) + one browser consent, then install the user unit and prove an archive;
      or (b) drop the Drive copy and keep the working nightly local archive
      (`pi-host-backup.timer`). The old failing system timer needs a sudo password to disable.

## LAN server pmpmt home, downloads and videos

Key + access: `ssh lan-pmpmt` → `pmpmt@192.168.1.60` (`~/.ssh/id_ed25519_lan-pmpmt`). Inventory and
reclaim tools: `scripts/downloads-inventory.sh`, `scripts/downloads-reclaim.sh` (dry-run by default;
refuses the current Cursor files by name).

- [ ] **Video clean-up on both hosts, not started.** Server: 406 videos outside `~/Videos` (there is
      no `~/Videos`): 18 real `.mp4` = 1.49 GB, plus 388 `.webm` voice-diary artefacts = 0.14 GB
      spread over `~/Documents` backups, `~/.voicediary`, `~/.vscode`, `~/Downloads`. Laptop: 42
      (2 real, 90.5 MB; 40 VoiceDiary dev `.webm` under `~/python`). Decide what counts as debris
      before deleting — the `.webm` files sit inside timestamped project backups. Dry-run first.
- [ ] 28 supplier spreadsheets live only in `pmpmt@192.168.1.60:~/Downloads/#Arquive_Downloads/Trabalhos Jo/`
      (business data, Jan/Feb 2026). If they should survive a disk failure, they need a real backup
      target, not a downloads folder.

## File dedupe tool (task brief ready, awaiting decisions)

Build `apps-scripts/file-dedupe/` — content-hash duplicate finder with quarantine, report and
5% re-verify. Targets: the 1 TB USB drive, then the two NTFS SATA disks on the server. Four
decisions to confirm (action / name sensitivity / size floor / multi-root). Full brief:
`agent/docs/runbooks/file-dedupe-plan.md`. Started 2026-11-20.

## VPS access: Tailscale SSH check expires (deferred 2026-11-20)

`neopmpmtj` has **no OpenSSH server** (`ssh.service` inactive/disabled); port 22 is served by
Tailscale SSH with `action: check`, so laptop→VPS access expires every few hours and silently
blocks `git pull`/`push` (broke sync three times on 2026-11-20). Do **not** run
`tailscale up --ssh=false` before an OpenSSH server is installed and proven — it would lock us
out. Two fixes: (A) admin console → Access controls, change that `ssh` rule `check` →
`accept`; or (B) install `openssh-server` on the VPS, add the laptop key
(`ssh-ed25519 …IGUdz6ZZiVtTj9ansz1I0nCiXtflUIgeDjw1Ka3HSUyR`), bind to the Tailscale address,
verify, then disable Tailscale SSH. Prefer B (key-based, never expires). Revisit after the
file-dedupe work.

## Voice-first access

- [ ] Paid voice once there is income: one branch in `speak.sh` (OpenAI `gpt-4o-mini-tts`,
      ~$0.015/1k chars). The seam exists already; nothing else changes.

## Dashboard, site and settings page (pending from the 2026-11-28 review)

- [ ] `/ask --set-default-effort default` is documented in three places but always throws:
      `agent/src/args.ts` accepts `default` in `EFFORT_LEVELS`, while `agent/src/default-model.ts`
      validates the saved value against `THINKING_LEVELS`, which has no `default`. Pick one: map it
      to `low` on save, or drop it from `EFFORT_LEVELS` and the help in `agent/README.md:43` +
      `agent/docs/CHEATSHEET.md:109`.
- [ ] `agent/README.md:21` (the file tree) still calls the field "effort"; the dashboard label, the
      launcher and `default-model.json`'s key are all `thinking` (`README.md:133`).
- [ ] web-master's doc copies still claim "no CORS setup" (`agent-web-master/README.md:178`) and
      "no CORS list" (`agent-web-master/web-master/docs/CHEATSHEET.md:128`), and its
      `GET /api/settings` row (`:140`) omits the settings.json fallback and the new `source` field —
      the same text corrected in cos's README/CHEATSHEET on 2026-11-28.
- [ ] `control/public/settings.html:20` says "default-model.json when that file exists"; the store
      writes web-master's `default-web-master-model.json` (`modelFile` in `control/agents.ts`).
      Name the per-agent override, not one hard-coded file.
- [ ] `scripts/serve-site.sh:13` still says "DASHBOARD-style env is not used here … reads
      PROJECT_PORT (127.0.0.1)", but `control/server.ts:22` reads `PI_SITE_BIND`, which
      `docs/pi-state-summary.md` and the voice runbook rely on.
- [ ] **The laptop's installed `pi-site` unit is stale.** `~/.config/systemd/user/pi-site.service`
      was copied before `EnvironmentFile=-%h/.config/pi-site.env` was added (the tracked copy and
      the VPS have it), so a `pi-site.env` on this host is silently ignored. Copy the tracked unit,
      `daemon-reload`, restart.
- [ ] **web-master's model catalogue was empty and is seeded by hand** (2026-11-28: copied
      `~/.pi/agent/models-store.json`; all four `enabledModels` are in it). Root cause: Pi refreshes
      the remote catalogue only on a network-enabled chat start, and web-master runs on `/ask`, so
      its `models-store.json` stayed `{}`. The blank provider/model selects that came from it are
      still possible: the settings tab does not say the catalogue is missing. Build that guard, or
      regenerate the seed when it drifts.
- [ ] Stale `DASHBOARD_PORT` / `DASHBOARD_ORIGIN` in two machine-local `.env` files:
      `agent-tasks-agent/.env` says 8790 (roster and live port are 8791) and
      `agent-template-new-agent/.env` says 8789, which is web-master's port. Inert today because
      `control/processes.ts` sets `DASHBOARD_PORT` itself and same-origin is now always accepted;
      wrong the moment either file is sourced by hand.
- [ ] Host notes claim pi `1.5.0` in two places (`/home/pmpmt/AGENTS.md:29` and `:79`); the runtime
      is `1.7.0`. Update the untracked host file and re-check the "devDeps must match" line.
