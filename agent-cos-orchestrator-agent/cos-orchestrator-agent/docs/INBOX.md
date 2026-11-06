# Inbox: agreed future work

Work that was agreed but not done. One line per item, newest at the bottom. Strike an item
through when it ships, with the date; do not delete it, so the history stays readable.

## sm-google-workspace

- [ ] More canned commands, in the spirit of `/gdrive-root` and `/inbox-new` — today's calendar,
      recent documents, unread from one sender, Drive search by name. Each one is a fixed
      `gog` call in `src/gog.ts` plus a command registration, so it costs no tokens.
      Home: `~/.pi/agent-gog-workspace-agents/sm-google-workspace/sm-google-workspace`.
- [ ] `--limit N` on the list-shaped canned commands (start with `/inbox-new`), so a busy inbox
      does not print forty rows. Same place.
- [x] ~~Confirm the keyring passphrase in that repo's `.env` is the current one; it was carried
      over from `~/archived-pi-agents-experts/gog-worksapce-agents/sm-google-workspace/.env`.~~
      Confirmed 2026-11-01: the repo keeps its own `.env` (mode 600, gitignored) with
      `GOG_ACCOUNT` and `GOG_KEYRING_PASSWORD`, and `gog` answers through the launcher.

## This agent

- [x] ~~`gpt-6.1-sol` is enabled in `settings.json` with no `OPENAI_API_KEY` in `.env`, so every
      launch prints `No models match pattern "gpt-6.1-sol"`. Waiting on the key, then re-check
      whether the sibling's `settings.json` should get the model back too.~~ Key placed
      2026-11-02; a live `gpt-6.1-sol` call answers, and no `auth.json` entry is needed because
      the launcher exports `OPENAI_API_KEY`.

## VPS `neopmpmtj`

- [ ] `~/.pi/agent/.env` on the VPS holds a dead `GEMINI_API_KEY` (`AQ.Ab8…`, 53 chars): a live
      Gemini call returns 401 "The bound service account is deleted or disabled". The working
      key is the `AIza…` one from the CoS replica's `.env`, which is what the four sibling
      `.env` files now use. User will replace it later; the VPS `~/.pi/agent` identity's Gemini
      models fail until then.
- [ ] Decide the Telegram ownership on the VPS: the CoS replica's `telegram.json` was left out
      on purpose (its token is identical to `~/.pi/agent/.env`'s, one polling owner). Retired
      copy sits at `~/retired-pi-cos-orchestrator-agent-20261102/`.

## lan-agent

- [x] ~~Set the real server address.~~ 2025-11-03: `host: 192.168.1.60` (Ubuntu 24.04,
      OpenSSH 9.6p1, port 22). `check` now stops at `Permission denied (publickey,password)`.
- [x] ~~Confirm `user: pistore` and `remoteRoot: /srv/pi-storage`.~~ 2025-11-03: both live, `check`
      READY, 50 MB round trip byte-identical. The `AllowUsers pmpmt` line was the blocker: sshd
      rejected a valid key and logged nothing. Now `AllowUsers pmpmt pistore`.
- [ ] `/srv/pi-storage` is on the server's **root filesystem** (73G, 33G free), not a data disk.
      Decide whether to mount a data volume there (by UUID in `/etc/fstab`) or accept it.
      Home: `~/.pi/agent-lan-agent/lan-agent`; see `docs/SETUP.md` → Open findings.
- [ ] Server sshd still allows password auth (`PasswordAuthentication yes`); flip to key-only once
      the key has been in use for a while. Same runbook, step B4.
- [ ] Reserve `192.168.1.60` in the router, or accept that a lease move needs
      `scripts/storage.sh use --host <ip>` before anything works again.
- [ ] Human step outstanding on the server: create the unprivileged user, install
      `~/.ssh/id_ed25519_lan-storage.pub`, mount the real data disk at `remoteRoot`, then
      harden sshd. Runbook: `docs/SETUP.md` there (origin: `docs/runbooks/lan-server-192.168.1.60/lan-file-server-ssh-setup.md`).

## LAN server as a work machine (agreed 2025-11-03)

Plan: `docs/runbooks/lan-server-192.168.1.60/lan-server-full-access-and-local-agent.md`.

- [x] ~~Create the `piadmin` admin identity.~~ Rejected by the user 2025-11-03: no third account.
      `pistore` was given blanket `NOPASSWD: ALL` instead (`/etc/sudoers.d/99-pistore-full`), so the
      storage identity is now also the admin identity. `sudo -n id` returns `uid=0(root)`.
- [x] ~~Decide where bulk storage lives.~~ 2025-11-03: `/home/pistore/storage` on `/dev/nvme0n1p7`
      (378G, 318G free), copied from `/srv/pi-storage` and verified with `check` + round trip.
      Old `/srv/pi-storage` left in place, empty.
- [x] ~~Inventory before any moving.~~ 2025-11-03: `docs/inventory/2026-11-03-home-pmpmt.md`
      — 42 GB, 14 GB user data, 17 GB dev caches, 13.7 GB of stale installers and backup tarballs.
- [ ] Batch A (awaiting go): move 55 files / 13.7 GB to `/home/pistore/storage/{installers,backups,media}`.
      Manifests already generated in `/home/pistore/storage/.manifests/`. Nothing deleted.
- [ ] Batch B (needs labels): what `#Arquive_Downloads` means, whether `cursor_scripts_python` is one
      project or many, and whether business documents group by year, client, or both.
- [ ] RTX 3060 is present (lspci) but `nvidia-smi` cannot reach the driver — diagnose Secure Boot
      MOK / DKMS / nouveau before planning Ollama and a local model.
- [x] ~~Install pi on the server (user `pmpmt`).~~ 2025-11-03: pi 1.4.0 on node v24.22.2, nvm
      default set, `~/.local/bin/pi` wrapper, PATH/nvm blocks in `.bashrc` and `.profile`. Runbook:
      `docs/runbooks/lan-server-192.168.1.60/server-pi-install.md`. No credentials yet — `~/.pi/agent` does not exist.
- [x] ~~Decide the server agent's model.~~ 2025-11-03: API keys now, local model later (user
      decision). `/home/pmpmt/.pi/agent/.env` holds the keys (600) and `auth.json` only references
      them via `!$HOME/.pi/agent/key <NAME>` — pi resolves the command per use. All three providers
      verified with live calls after the change.
- [ ] Eventually give the server's pi its own agent home + ledger and a laptop-side shim so CoS can
      call it the way it calls the local siblings.
- [ ] Safeguards, once the organisation work is finished: re-scope `piadmin` sudo to the commands
      actually used, snapshot the move log, optional restic/borg to an external disk.

## Group rename, left open

- [x] ~~The GitHub repository is still `neopmpmtj/gog-worksapce-agents`, because the local
      folder was renamed and the remote was not.~~ Renamed on GitHub 2026-11-01. The `url` in
      `~/pi-agents-experts-grouped/.gitmodules`, the parent's `.git/config` and the submodule's
      own `origin` all point at `gog-workspace-agents.git` now.
- [ ] `~/archived-pi-agents-experts/gog-worksapce-agents` keeps the old spelling: it is a
      separate archived tree and was not part of this rename.

## LAN server `pmpmt` home, downloads and videos (started 2026-11-03)

Key + access: `ssh lan-pmpmt` → `pmpmt@192.168.1.60` (`~/.ssh/id_ed25519_lan-pmpmt`, installed via
`pistore`'s NOPASSWD sudo). Runbook: `docs/runbooks/lan-server-192.168.1.60/lan-pmpmt-ssh-key.md`.
Inventory + reclaim tools: `scripts/downloads-inventory.sh`, `scripts/downloads-reclaim.sh` (dry-run
by default; refuses the current Cursor files by name).

- [ ] **Video clean-up on both hosts, not started.** Server: 406 videos outside `~/Videos` (there is
      no `~/Videos`): 18 real `.mp4` = 1.49 GB, plus 388 `.webm` voice-diary artefacts = 0.14 GB
      spread over `~/Documents` backups, `~/.voicediary`, `~/.vscode`, `~/Downloads`. Laptop: 42
      (2 real, 90.5 MB; 40 VoiceDiary dev `.webm` under `~/python`). Decide what counts as debris
      before deleting — the `.webm` files sit inside timestamped project backups. Dry-run first.
- [ ] `lan-agent`'s `config/storage.json` is still pinned to `pistore:/home/pistore/storage`, so
      `/storage` commands cannot see `/home/pmpmt`. Either repoint it at `lan-pmpmt`, or keep the
      two-identity split (`lan-storage` for storage, `lan-pmpmt` for home) and document it.
- [ ] Server sshd still has `PasswordAuthentication yes` for `pmpmt`; same open item as `pistore`
      above — flip both to key-only once the keys have settled.
- [ ] 28 supplier spreadsheets live only in `pmpmt@192.168.1.60:~/Downloads/#Arquive_Downloads/Trabalhos Jo/`
      (business data, Jan/Feb 2026). If they should survive a disk failure, they need a real backup
      target, not a downloads folder.

## JEV

- Current state of the classifiers: `~/.pi/docs/pi-state-of-jev.md`.

## Calendar routing (first live node, 2026-11-04)

- [x] ~~Classify a definite calendar entry and route it to the calendar agent.~~ Live:
      `~/.pi/decision-nodes/calendar/` (`config.py` router, `route.py` caller) + hook
      `extensions/calendar-node/index.ts` in this home. Walkthrough:
      `~/.pi/decision-nodes/calendar/README.md`, runbook: `docs/runbooks/calendar-routing.md`.
- [x] ~~**Fill `do:calendar:create`** in `~/.pi/decision-nodes/calendar/config.py`.~~
      Shipped 2026-11-04. Shape: **chained** — route 1's answer opens FREE / BUSY / UNKNOWN
      and only FREE writes. Fields come from one `deepseek-flash` JSON call, then validated
      (parsed, not past, confidence ≥ 0.5, 60 min default), then `gog calendar create primary`.
      Policy: **write immediately**, chosen by the user 2026-11-04. Verified live: an event was
      created on 2026-11-05 15:00 and deleted again. 21 offline node tests + 16 harness tests.
- [x] ~~A **canned calendar read** for route 1, in the spirit of `/inbox-new`: a fixed
      `gog calendar freebusy` call that prints FREE/BUSY with no model turn, replacing the
      ~13 s sibling turn.~~ Shipped 2026-11-04: `do:calendar:gog` now runs
      `gog calendar freebusy primary --from --to` on the resolved window, ~0.3 s, no tokens.
      A match now costs ~3 s of node work instead of ~16 s.
- [x] ~~**Decide whether a match should swallow the turn** (`action: "handled"` in
      `extensions/calendar-node/index.ts`).~~ Shipped 2026-11-04: local surfaces (TUI, `-p`)
      swallow the turn — trace and outcome printed, no model turn, no session entry — while a
      Telegram prompt (prefix `[telegram`) keeps the relay turn because the bridge only
      delivers assistant text. Verified: local run in 9 s with no assistant message.
- [x] ~~Telegram still pays one relay turn. A canned `telegram_message` (or a generated
      control surface) that sends the outcome without a model turn would close it.~~
      Shipped 2026-11-04: the hook sends the outcome through the bridge's delivery API
      (`@llblab/pi-telegram/delivery`, scope `active-turn` then `instance`) and returns
      `handled`. If delivery fails it does **not** swallow - the reply relays as before.
- [x] ~~**Decide which pi home owns Telegram.**~~ Decided 2026-11-04: the **VPS keeps the
      bridge only**; the laptop runs no bot and holds no token. The calendar route's Telegram
      path is therefore exercised on the VPS. Checklist with the state of `neopmpmtj`:
      `docs/runbooks/calendar-routing-on-vps.md`.
- [ ] VPS enablement, as found on 2026-11-04: `~/.pi` clone is behind (node + extension +
      `calendarNode` arrive with `git -C ~/.pi pull --ff-only`), `gog` is **not installed**
      (config dirs exist), and `~/.pi/jev-classifier/.env` is missing `TYPESAFE_API_KEY`.
      Steps and verification commands are in the runbook above.
- [ ] **On hold** (2026-11-05). The duplicate guard matches titles only; a second phrasing
      of the same event ("Dinner with Rita" vs "Rita dinner") is not caught. Leave the
      title check as it is. Matching on the window, or on title similarity, waits.
- [x] ~~Attendees, reminders and recurrence on `do:calendar:create` — `gog` supports all three
      (`--attendees`, `--reminder`, `--rrule`); nothing in the node passes them yet.~~
      Shipped 2026-11-05. The extractor may return emails, `popup:30m` / `email:1d`
      reminders, and one `FREQ=` rule. Invalid values are dropped. The write passes
      `--attendees`, `--reminder`, and `--rrule`.
- [x] ~~Telegram on this laptop.~~ Decided 2026-11-05: this laptop does not use Telegram.
      The bridge stays on the VPS; the laptop item is not open work.

## Skills

- [ ] `svg-photo-convert` (created 2026-11-04) was **self-tested only**: this agent has no
      subagent tool and no `claude` CLI, so the four prompts in
      `skills/svg-photo-convert/evals/evals.json` never ran as with-skill/baseline pairs, and
      the description was not optimised against trigger queries. Both need a harness with
      subagents; the measured self-test results are in `evals/README.md`.

## Next decision nodes (agreed 2026-11-05)

- [ ] A new decision node lives in `~/.pi/decision-nodes/<name>/` and reads its own slice of
      the JSON `classify.py` already returns, so one message stays one JEV call. The node
      stays out of `jev-classifier-multi/src`.
- [x] ~~When a fourth class is added, change `classes/__init__.py` so it loads every module in
      `classes/` instead of the three handwritten imports. Adding a class is then one file.
      Home: `~/.pi/jev-classifier/jev-classifier-multi/src/classes/`.~~
      Done 2026-11-05 with the `reminder`, `reminder_done` and `vetoes` modules.
- [ ] Leave `classes/calendar.py` as one file until its questions and `decide` no longer fit
      there. A `classes/calendar/` package waits for that.

## Reminder routing on this host (found 2026-11-06)

- [x] ~~Classifier missing on this host, so the `reminder`/`calendar` hooks always failed open.~~
      Fixed 2026-11-06: `~/.pi/jev-classifier` cloned at the pinned gitlink `6b43d6d`, and
      `TYPESAFE_API_KEY` placed in `~/.pi/jev-classifier/.env` (mode 600, gitignored). Live
      checks: `reminder` band `act` 0.99 on "remind me to take a tablet at 08:00", `calendar`
      band `act` 0.99 on "add dentist appointment to my calendar on tuesday at 10:30"; the 25
      node tests pass. A bare "dentist on tuesday at 10:30" (no intention verb) scores
      `calendar` 0.18, below the 0.7 threshold - that is the model's call, not a fault.
- [ ] `~/.pi/decision-nodes/reminder/reminders.jsonl` is **untracked** here although the node's
      README calls it tracked with `merge=union`, so the one row on this host
      (`r-20261106-c42b`) will not reach the laptop over git. Decide: add it to the workspace
      repo with `merge=union` as the README already promises, or keep it host-local and say so
      in that README.
