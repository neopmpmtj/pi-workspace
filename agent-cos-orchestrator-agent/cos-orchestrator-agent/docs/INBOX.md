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
      harden sshd. Runbook: `docs/SETUP.md` there (origin: `docs/runbooks/lan-file-server-ssh-setup.md`).

## LAN server as a work machine (agreed 2025-11-03)

Plan: `docs/runbooks/lan-server-full-access-and-local-agent.md`.

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
      `docs/runbooks/server-pi-install.md`. No credentials yet — `~/.pi/agent` does not exist.
- [ ] Decide the server agent's model: copy API keys into `/home/pmpmt/.pi/agent/.env`, or wait for
      the 3060 driver fix and point pi at a local Ollama endpoint.
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
