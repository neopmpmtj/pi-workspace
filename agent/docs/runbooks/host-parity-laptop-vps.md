# Host parity: laptop ↔ VPS (`neopmpmtj`)

Goal: both hosts run the same agent installation — same repo commit, same pi
runtime, same node, same package tree. `~/.pi/agent#copy` is out of scope.

Written 2026-11-19 after a side-by-side inspection. Nothing here has been
executed yet.

## Diagnosis (measured, 2026-11-19)

| Thing | Laptop | VPS | Verdict |
| --- | --- | --- | --- |
| `~/.pi` HEAD | `7906e1e` (= `origin/main`, 0/0) | `e82048f` (behind 4, clean tree) | VPS lags; laptop is tip |
| `~/.pi` working tree | dirty: `.gitignore` clobbered, stray `$.gitignore`, untracked dirs | clean | laptop needs repair |
| `.gitignore` | working copy **2 lines / 14 B**, HEAD version 142 lines | 142 lines (HEAD) | laptop file was truncated 2026-11-19; full copy of HEAD sits in stray `$.gitignore` (2026-11-18) |
| pi version | `1.5.2` | `1.5.2` | same (an older note in `/home/pmpmt/AGENTS.md` still says 1.5.0 — stale) |
| node (pinned by launcher) | `v24.21.0` | `v24.21.0` | same |
| node (shell default) | `v24.21.0` | `v22.22.2` | VPS nvm default alias differs (cosmetic; launchers pin PATH) |
| `agent/npm/node_modules` | 1 pkg: `@llblab/pi-telegram@0.59.2` (clean) | 200 pkgs: `@llblab/pi-telegram@0.58.3` + ~199 orphans (`express`, `defuddle`, `cors`, `ajv`, …) | VPS stale + bloated |
| `agent/npm/package.json` | `@llblab/pi-telegram ^0.59.2` | same | same |
| `agent/npm/package-lock.json` | present, 0.59.2 | present, 0.59.2, but installed dir is 0.58.3 | VPS lock ≠ installed |
| `agent/node_modules` (devDeps) | absent | absent | both: `npm run typecheck` broken |
| `NODE_PATH` | unset | unset | same |

Root causes:

1. `agent/npm/` is **gitignored** (`~/.pi/.gitignore:36`), so the package manifest
   and lock are not synced — each host resolves its own tree.
2. The laptop's root `.gitignore` was overwritten with a 2-line stub, so
   previously-ignored paths (`agent/npm/`, `agent/bin/`, `agent(tmp)`, `config.json`,
   `cron/jobs.json`, …) now report as untracked.
3. Node/pnpm/npm trees were installed ad hoc on each host, never from one lock.

## Target state

- both: `git -C ~/.pi rev-parse HEAD` equal to `origin/main`, clean tree
- both: pi `1.5.2` under `~/.nvm/versions/node/v24.21.0` (already true)
- both: `agent/npm` installed from a **tracked** `package.json` + `package-lock.json`
  → exactly `@llblab/pi-telegram@0.59.2`, no orphans
- both: `agent/node_modules` installed from the tracked devDeps (typecheck works)
- both: nvm default alias `v24.21.0`

## Steps

Status 2026-11-19: steps 2 (VPS pull), 4 (npm trees) and 5 (devDeps) done; the
only remaining diff is the laptop's two untracked files (this runbook and
`~/.pi/scripts/`), which are not pushed yet by choice.

### 1. Repair the laptop repo (do first — nothing else can be trusted before it)

```bash
cd ~/.pi
git diff --stat .gitignore        # 142 lines deleted — confirm before curing
git checkout -- .gitignore        # restore the committed 142-line file
rm -f './$.gitignore'             # stray copy made by a bad redirect on 2026-11-18
git status --porcelain | head -40 # now only genuinely local files should show
```

### 2. Sync the VPS repo

```bash
ssh neopmpmtj 'cd ~/.pi && git pull --ff-only && git log --oneline -1'
```

### 3. Track the package manifest (one commit, laptop side)

`~/.pi/.gitignore` currently ignores `agent/npm/` wholesale. Narrow it so the
manifest and lock travel but `node_modules` does not:

```gitignore
agent/npm/node_modules/
agent/npm/package-lock.json   # -> DELETE this ignore line (keep the lock tracked)
```

Then:

```bash
cd ~/.pi
git add .gitignore agent/npm/package.json agent/npm/package-lock.json
git commit -m "chore(npm): track agent/npm manifest and lock for host parity"
git push
ssh neopmpmtj 'cd ~/.pi && git pull --ff-only'
```

Note: `package-lock.json` is also ignored globally in the laptop stub — check the
restored file (`grep -n package-lock .gitignore`) before committing; the lock must
end up tracked, so use `git add -f` if a broad ignore rule still matches it.

### 4. Rebuild `agent/npm` identically on both hosts

`npm ci` **must** carry `--legacy-peer-deps`: the lock has no entries for
pi-telegram's peer deps (pi-ai, pi-agent-core, typebox — host-provided), and plain
`npm ci` aborts with "Missing: @earendil-works/pi-schema@1.5.2 from lock file"
after it has already deleted `node_modules`. Verified 2026-11-19: with the flag,
both hosts install exactly one package.

```bash
cd ~/.pi/agent/npm && rm -rf node_modules && npm ci --omit=dev --legacy-peer-deps
ssh neopmpmtj 'cd ~/.pi/agent/npm && rm -rf node_modules && npm ci --omit=dev --legacy-peer-deps'
```

Expected on both: `pi-extensions@ └── @llblab/pi-telegram@0.59.2`, one entry.

Done on the VPS 2026-11-19 by `rsync` from the laptop (same result, no registry
round trip); the running `pi-vps-agent` session reported `telegram connected`
afterwards, so a live rebuild does not need a restart.

### 5. Install the agent's devDeps on both (fixes `npm run typecheck`) — DONE 2026-11-19

Outcome: both hosts ended up with `pi-ai@1.5.2`, `pi-coding-agent@1.5.2`,
`typebox@1.4.7`, `typescript@5.9.3`, 80 dirs; `npm run typecheck` exits 0 on both.
The VPS had its own older `agent/package-lock.json` pinning `1.5.0`/`1.4.5`; it was
replaced by the laptop's lock (generated by `npm install`) and `npm ci` re-run there.
Both locks are now **tracked** (commit `3e9a7e9`, local, unpushed): the root
`.gitignore` keeps ignoring `package-lock.json` generally but re-includes
`agent/package-lock.json` and `agent/npm/package-lock.json`; the blanket `agent/npm/`
rule was narrowed to `agent/npm/node_modules/`, `package-lock.json` was dropped from
`agent/.gitignore`, and the stray `agent/npm/.gitignore` (`*`) was deleted. The dependency is pinned
exactly (`"@llblab/pi-telegram": "0.59.2"`, no caret) so `pi update --extensions`
cannot move the tree on one host only — bumping is a deliberate manifest edit.


pi itself is already `1.5.2` on both hosts, so only the agent-home devDeps are
missing. The tracked `package.json` asks for `^1.5.0` of the pi packages; pin it to
the installed `^1.5.2` in the same commit as step 3, then:

```bash
cd ~/.pi/agent && npm install
ssh neopmpmtj 'cd ~/.pi/agent && npm install'
```

### 6. Align the shell default node (VPS only, cosmetic)

```bash
ssh neopmpmtj 'source ~/.nvm/nvm.sh && nvm alias default 24.21.0'
```

### 7. Verify

```bash
bash ~/.pi/scripts/check-host-parity.sh
```

Exit 0 means every row matches. Re-run after any upgrade on either host.

## Out of scope (asked separately)

- `~/.pi/agent#copy` (359 MB on the VPS) — explicitly excluded.
- Sibling agent homes differ in roster and `node_modules` (laptop:
  `agent-lan-agent`, `sm-google-workspace`, image-describer 6 pkgs; VPS:
  `tasks-agent` 79 pkgs, template/new-agent). Bringing those to parity is a
  separate, larger change.
- Machine-local state stays per-host by design: `.env`, `auth.json`,
  `telegram.json`, `config.json`, `cron/jobs.json`, `sessions/`, `models-store.json`.

## Files that will collide when you alternate hosts

A conflict needs two different writes to the same tracked path between two syncs.
The sequence that causes one: host A pushed → host B starts with a dirty copy of the
same file (or edits it before pulling) → B's auto-sync push rebases and fails.

| Path | Written by | Risk | Suggested action |
| --- | --- | --- | --- |
| `agent/settings.json` | pi itself: theme, `lastChangelogVersion`, `packages`, `extensions`, model defaults | **highest** — touched by both hosts' auto-sync commits (`cc5dfdb`, `f56e958`) | keep tracked (it is shared config) but never hand-edit on both; accept rare conflict |
| `agent/trust.json` | pi on project-trust decisions | high (`fe7df21`) | per-host → ignore, or keep and resolve |
| `decision-nodes/reminder/reminders.jsonl` | reminder node, one appended line per reminder on whichever host heard it | high (`bcf0b40`, `8e55df5`; 9 commits of history) | both appends land at EOF → textual conflict; decide whether reminders are shared (keep) or per-host (ignore) |
| `agent/npm/package.json`, `agent/npm/package-lock.json`, `agent/package-lock.json` | `npm install`, `pi update --extensions` | medium — spec is pinned now, but npm rewrites lock metadata | keep tracked; reinstall both hosts after any change |
| `agent-web-master/web-master/settings.json` + `trust.json` + `default-web-master-model.json` | web-master runs, model switch | medium (`8b71cb2`) | per-host state |
| `agent-tasks-agent/tasks-agent/settings.json` + `trust.json` | tasks-agent runs | medium | per-host state |
| `agent-gog-workspace-agents/sm-google-workspace/sm-google-workspace/settings.json` + `trust.json` | gog agent runs | medium | per-host state |
| `agent-image-describer/image-describer/settings.json` | describer runs | medium | per-host state |
| `agent-template-new-agent/template-new-agent/settings.json` + `trust.json` | template agent runs | low | per-host state |
| `.dashboard-logs/*.pid` | dashboards, per host | **not ignored** — deletions were already committed once (`7906e1e`) | add `.dashboard-logs/` to `.gitignore` |
| `agent/skills/*` (gitlinks), `jev-classifier` | `git submodule update` | low — only if both move the pointer | update one host, pull the other |
| `docs/INBOX.md`, `docs/pi-state-summary.md`, runbooks, code | you, by hand | low under one-host-at-a-time | commit before switching hosts |

Already safe (ignored, verified with `git check-ignore`): `agent/.env`, `auth.json`,
`telegram.json`, `model-rates.json`, `models-store.json`, `agent/tmp/`, `agent/logs/`,
`agent/sessions/`, `cron/jobs.json`, `/config.json`, `/input-phrase-config.json`,
`/prompt-build-config.json`, `decision-nodes/**/verdicts.jsonl`, `review.jsonl`,
`state/prompt-capture/`, `**/tmp/pi-telegram/`, all `node_modules/`.

## When commit `d3be288` reaches the VPS (read before pulling)

That commit stops tracking `**/trust.json` and deletes `agent/.gitignore`. A pull on
the VPS will therefore **delete the five `trust.json` files** from its working tree
(git removes them; the ignore rules only stop them coming back). Trust decisions are
per host, so preserve them across the pull:

```bash
ssh neopmpmtj 'mkdir -p /tmp/trust-bak && cd ~/.pi && for f in agent/trust.json agent-web-master/web-master/trust.json agent-tasks-agent/tasks-agent/trust.json agent-gog-workspace-agents/sm-google-workspace/sm-google-workspace/trust.json agent-template-new-agent/template-new-agent/trust.json; do [ -f "$f" ] && install -D "$f" "/tmp/trust-bak/$f"; done'
ssh neopmpmtj 'cd ~/.pi && git pull --ff-only'
ssh neopmpmtj 'cd /tmp/trust-bak && find . -name trust.json -exec cp --parents {} /home/pmpmt/.pi/ \; && ls -l /home/pmpmt/.pi/agent/trust.json'
```

After that the layout is identical on both hosts: `.gitignore` at the repo root is the
single source of ignore rules (the nested `agent/.gitignore` is gone), and the whole
per-host inventory sits under one titled section, "PER-HOST STATE".

## Ignore rules live in one file

`~/.pi/.gitignore` is the only ignore file that governs the agent homes. The five
`agent-*/.gitignore` files and `agent-web-master/web-master/npm/.gitignore` were folded
into it on 2026-11-19 (13 → 8 files repo-wide, and the 8 left are vendored projects under
`apps-scripts/` whose layout is not ours). Verification used on that change: a 22-path
`git check-ignore` probe and the full ignored-file snapshot, both identical before/after.

## Automation

| Script / hook | What it does |
| --- | --- |
| `scripts/check-host-parity.sh` | read-only fingerprint table (commit, pi, node, packages, submodules, settings core); exits 1 on any drift |
| `scripts/sync-hosts.sh check` | fetch **both** hosts (so a stale ref cannot answer "already up to date"), print ahead/behind + dirty, then parity |
| `scripts/sync-hosts.sh pull` | `fetch --all --prune` + `pull --ff-only` + `submodule update --init --recursive` on both hosts |
| `scripts/sync-hosts.sh push` | push local commits, then pull the VPS the same way |
| `scripts/sync-hosts.sh setup` | `git config core.hooksPath .githooks` on both hosts |
| `.githooks/post-merge` | after any pull: initialise missing submodules, `npm ci` **only** if `agent/package*.json` or `agent/npm/package*.json` arrived, then remind to run the parity check |
| `scripts/update-pi-both-hosts.sh` | `pi update` on both, reinstall pinned packages, restart the VPS agent, wait for `telegram connected`, verify |
| `scripts/env.sh` | single source for the nvm node path (`PI_NODE_BIN`) and `PI_REPO`; sourced by every script above |
| `scripts/pre-sync.sh` | the launchers' debounced `pull --ff-only`; fetches again on failure and **prints ahead/behind** instead of a one-line shrug |
| `scripts/backup-host-state.sh` + `systemd/pi-host-backup.{service,timer}` | nightly 03:30 archive of the per-host state into `~/pi-host-backups`, mode 600, 14 kept, optional `PI_BACKUP_REMOTE` rsync |
| `scripts/fingerprint.sh` | offline `KEY=value` fingerprint of one host (git, pi, node, packages, submodules, settings core) |
| `scripts/publish-fingerprint.sh` | laptop → VPS over ssh into `agent/tmp/parity/<host>.fingerprint`; called from `pre-sync.sh`. Fallback only since 2026-11-19: the VPS can now ssh in (`laptop-sshd-tailscale-only.md`) |
| `scripts/parity-alert.sh` + `systemd/pi-parity-check.{service,timer}` | VPS-only, daily 09:00: fingerprints the laptop **live over ssh** (`Host laptop`, Tailscale-only) and falls back to the last published file when it is unreachable; messages Telegram on install drift or when the VPS is behind origin; logs every run to `logs/parity-alert.log` |
| `extensions/auto-sync.ts` | now unstages anything matching the per-host list before committing, warns, and names the files to add to `.gitignore` (`agent/settings.json` exempt) |

Nothing here commits or resets: `extensions/auto-sync.ts` still owns commit-on-shutdown,
and a dirty tree is reported rather than repaired.

## Node trees on the VPS: do not prune (checked 2026-11-19)

`/usr/bin/node` is a root symlink to `~/.nvm/versions/node/v22.22.2/bin/node`, and the
`openclaw-gateway.service` user unit runs `v24.18.0`. Both of those nvm trees are **live**;
only `v24.21.0` carries pi. `~/.npmrc` `prefix-warning=false` was removed (cosmetic warn).

## Reminders: current reality (checked 2026-11-19)

The reminder node is **disabled on the laptop** (`reminderNode.enabled: false`, writer
`store`) and enabled on the VPS with writer **`tasks`** (Google Tasks). So the only host
that routes reminders writes to Google, not to `reminders.jsonl`; the 34-line
`reminders.jsonl` on both hosts is legacy data. No divergence happens today. If routing is
ever enabled on the laptop, set `writer: tasks` there too so both hosts share one store.

### Testing the alert

`PI_PARITY_TEST=1 bash ~/.pi/scripts/parity-alert.sh` (on the VPS) injects one synthetic
drift field and sends a real Telegram card prefixed `🧪 test message`, without touching
either host. Verified end to end 2026-11-19 (`alert sent: 1 drift field(s)`); the very
next clean run logged `ok (… source=live via laptop)` and sent nothing.

## Gotchas that survive parity (as of 2026-11-19)

1. `agent/settings.json` is still **tracked** and pi rewrites it (theme, model
   defaults, `packages`, `lastChangelogVersion`). It is the next file that will
   conflict; treat it as shared config and never hand-edit it on both hosts.
2. `decision-nodes/reminder/reminders.jsonl` is still **tracked** and is appended on
   whichever host hears the reminder. Two appends at EOF = conflict, and a merged
   file means each host sees the other's reminders. Undecided on purpose.
3. Sibling `settings.json` files and `agent-web-master/web-master/default-web-master-model.json`
   are still tracked → same drift as `trust.json` before it was ignored.
4. `pi update` (self) is invisible to git: it bumps the global install on one host
   only. Run it on both hosts, or let the parity script catch the split.
5. `agent/npm` needs `npm ci --omit=dev --legacy-peer-deps`. Plain `npm ci` deletes
   `node_modules` and then aborts on the missing peer entries.
6. ~~Both `.env` files carry the same Telegram token.~~ Checked 2026-11-19: the
   laptop's `TELEGRAM_BOT_TOKEN` is already commented out ("deliberately unset on this
   laptop, 2026-11-06"); only the VPS has it. One poller per token holds, no action.
7. Per-host by design, so they will never match: `logs/ledger.sqlite` (so `/usage`
   numbers differ per host), `sessions/`, `models-store.json`, `model-rates.json`.
8. VPS still holds 359 MB in `~/.pi/agent#copy` — ignored, unused, not deleted yet.
9. A fresh clone is **not** complete until `git submodule update --init --recursive`
   runs: five skill submodules and `jev-classifier` are gitlinks, and an
   uninitialised checkout silently ships empty skill directories. The parity script
   now compares them (`SUBMODULES` = hash of the six SHAs, `SUB_INIT` = initialised
   count); laptop caught up with the VPS on 2026-11-19.
10. `agent/settings.json` divergence is now checked by the parity script
   (`SETTINGS_CORE` = hash of extensions/packages/enabledModels/defaultProvider/
   defaultModel, plus `SETTINGS_EXT` counts), so ignore-vs-track is enforced either way.

## Decisions taken 2026-11-19

1. **Reminders are per host.** `decision-nodes/reminder/reminders.jsonl` is untracked
   and ignored; each host keeps its own file on disk, so a reminder made on the VPS
   stays on the VPS. No code change was needed — the path is unchanged, only its
   tracking. Side effect: the file must be backed up across any pull that deletes it.
2. **Sibling settings are per host.** `settings.json` in the web-master, tasks-agent,
   sm-google-workspace, image-describer and template-agent homes, plus
   `default-web-master-model.json`, are untracked and ignored. Configure a sibling on
   the host that runs it.
3. **`agent/settings.json` stays tracked** (the one exception). It holds what must be
   identical on both hosts: the `extensions` list, `packages`, `enabledModels`,
   `defaultProvider`/`defaultModel`. Ignoring it would let the two hosts load
   different extensions while looking identical. Its only routine rewrite is
   `lastChangelogVersion` on a pi upgrade, so conflicts are rare and trivially
   resolved; the runbook rule is: never hand-edit it on both hosts between syncs.
   Model selection per host already lives in `agent/default-model.json` (ignored).
4. **`pi update` is a two-host operation.** Use `scripts/update-pi-both-hosts.sh`,
   which upgrades both, reinstalls the pinned packages, restarts the VPS agent and
   runs the parity check.
5. `~/.pi/agent#copy` (359 MB) stays for now, by request.

## Remaining, not urgent

- `agent/settings.json` conflict policy (see 3) is a convention, not enforcement.
- Sibling rosters differ (laptop: lan-agent, sm-google-workspace, image-describer;
  VPS: tasks-agent, template agent), so some tracked sibling code only ever runs on
  one host.
- `z.old/` was already ignored (`z.old/`, Misc section).
