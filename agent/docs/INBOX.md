# Inbox: agreed future work

Open work only. One item per block, newest at the bottom of its section. When an item ships,
**move it out**: delete it here and add one compressed line to `INBOX-DONE.md` (date, what,
closing fact, proof path or commit) in the same edit. Nothing closed, ticked or struck stays in
this file — it is read on almost every turn and history costs context. The full original wording
is recoverable from the git history of this file.

## sm-google-workspace

- [ ] More canned commands, in the spirit of `/gdrive-root` and `/inbox-new` — today's calendar,
      recent documents, unread from one sender, Drive search by name. Each one is a fixed
      `gog` call in `src/gog.ts` plus a command registration, so it costs no tokens.
      Home: `~/.pi/agent-gog-workspace-agents/sm-google-workspace/sm-google-workspace`.

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
