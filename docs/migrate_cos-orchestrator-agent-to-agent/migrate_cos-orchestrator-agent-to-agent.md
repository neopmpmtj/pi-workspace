# Migrate the COS orchestrator agent home into `~/.pi/agent`

> **Status: PLAN ONLY — nothing below has been executed.**
> The only file written so far is this plan.
>
> - Written: 2026-11-18, by `pi` running in the default home (`~/.pi/agent`), SSH session.
> - Baseline revision: `8849648` (`inbox: verify the 2026-11-26 day-8 verdict ping arrived`).
> - Host: `neopmpmtj` (VPS, Ubuntu 24.04, user `pmpmt`), pi `1.5.2`.
> - Target: flatten `~/.pi/agent/cos-orchestrator-agent/` into `~/.pi/agent/`, so
>   `~/.pi/agent` **is** the chief-of-staff home and no nested agent home remains.
> - Owner approval required before Phase 0.

---

## 0. Summary of the plan

We have a COS orchestrator agent, and it is the main orchestrator. But it lives in a
home nested **inside** another agent home (`~/.pi/agent/cos-orchestrator-agent`), which
means there are two homes, two launchers, two `.env` files, and a supervisor that points
at a path that no longer exists. That arrangement is not working out.

The plan is to move every durable thing the COS home has onto the outer home,
`~/.pi/agent`, then fix every path that pointed at the nested directory, verify, and
restart the same `pi-cos.service` against the flat home. The Telegram bot, the bot token,
the model, the extensions, the skills, the ledger, the sessions and the docs all survive;
only the directory boundary disappears.

The `observability/` folder is confirmed **dead** (see §2.4) and is archived as part of
the same change.

The four decisions I still need from the owner are listed in §11.

---

## 1. Goal and definition of done

### Goal

- One Pi agent home on this host: `~/.pi/agent`.
- `PI_CODING_AGENT_DIR` is either unset (Pi's default is already `~/.pi/agent`) or set to
  `~/.pi/agent` by the launcher. No `cos-orchestrator-agent` directory remains.
- The same systemd service (`pi-cos.service`) runs the chief of staff, with the same
  Telegram bot, from the flat home.
- Extensions, skills, prompts, ledger, sessions, dashboard, scripts and docs all work from
  the new layout.
- All live docs and the control plane point at `agent`, not `agent/cos-orchestrator-agent`.
- `npm run typecheck` and `npm test` pass in the agent home.
- `git status` is clean except gitignored runtime state; the migration is committed and
  pushed only after the service is verified.
- `~/.pi/docs/pi-state-summary.md` and `~/AGENTS.md` describe the new reality.

### Non-goals

- No rebrand of the agent's identity. It is still "COS orchestrator / chief of staff".
- No change to the Telegram bot, owner id, model choice, extension behaviour, ledger
  schema, or dashboard ports.
- No rewrite of historical records (`docs/documented-from-session/**`, `.cursor/plans/**`).
- No attempt to fix the two invalid `GEMINI_API_KEY`s (noted in §10, separate task).
- No change to the sibling agents or their launchers.

---

## 2. Current state (evidence, 2026-11-18 ~16:15 UTC)

### 2.1 Processes

| PID | Since | Home | Role |
|---|---|---|---|
| 329655 | 2026-11-07 19:33 | `~/.pi/agent/cos-orchestrator-agent` | the `pi-cos.service` instance; tmux pane says **telegram connected** |
| 858696 | 2026-11-18 12:41 | `~/.pi/agent/cos-orchestrator-agent` | a second, idle `pi` in a VS Code terminal (parent: vscode-server ptyHost) |
| 873618 | 2026-11-18 16:12 | `~/.pi/agent` | this session (default home, SSH login, no Telegram token) |

- `pi-cos-supervisor.sh` is PID 329631, started 2026-11-02.
- `tmux -L pi-cos` has one session, created 2026-11-07 19:33.
- The service is active; the legacy `pi-agent.service` is disabled/inactive.

### 2.2 The two homes

`~/.pi/agent/` (the target) currently contains:

```
.env .env.example .gitignore README.md auth.json
bin/ (fd, gog)  logs/ (gog-keepalive logs)  models-store.json
npm/ (superset: @llblab/pi-telegram 0.58.3, @mjakl/pi-subagent, pi-agent-browser-native,
      pi-agents-pool, pi-web-access, ...)
observability/ (dead, §2.4)  pi-web-access/  sessions/  settings.json
telegram.json (typo: "$TELEGRAM_BOT_TOKE_N")  tmp/pi-telegram (stale, 2026-11-02)
trust.json
cos-orchestrator-agent/   ← the real home, nested
```

`~/.pi/agent/cos-orchestrator-agent/` currently contains:

```
.env (DEEPSEEK, GEMINI, OPENAI, TELEGRAM_BOT_TOKEN)   AGENTS.md   APPEND_SYSTEM.md
agent.json  auth.json  bin/fd  dashboard/  docs/  events.log  extensions/ (18 entries)
ledger/ (8 .ts)  logs/ledger.sqlite*  models-store.json  node_modules/ (187 MB)
npm/ (@llblab/pi-telegram only)  package-lock.json  package.json  prompts/ (6)
scripts/ (7)  sessions/ (2.7 MB)  settings.json  skills/ (7, 5 are submodules)
src/ (25 .ts)  state/prompt-capture/  telegram.json  test/ (24)  tmp/pi-telegram
trust.json  tsconfig.json
```

Sizes: `~/.pi/agent` ≈ 360 MB total; 46 GB free on `/`.

Tracked in git under `agent/`: 151 files under `cos-orchestrator-agent`, plus 6 files in
`agent/` itself (`.env.example`, `.gitignore`, `README.md`,
`model-rates.example.json`, `settings.json`, `trust.json`).

### 2.3 Defects already visible

1. **Supervisor path is dead.** `pi-cos-supervisor.sh` sets
   `AGENT_DIR="$HOME/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent"`. That
   directory does not exist. Its `cos_pids()` therefore never matches, so
   `wait_for_previous` always returns immediately and the 40-second "previous instance
   still running" guard is a no-op.
2. **Telegram state carries the dead path.** `tmp/pi-telegram/state.json` has a
   `journalPath` under `/home/pmpmt/.pi/agent-cos-orchestrator-agent/...` and `cwd` under
   the nested home. The bridge tolerates the missing journal today, but the state is
   stale.
3. **Two credential files and two stories.** `APPEND_SYSTEM.md` says credentials are at
   `~/.pi/agent/.env` ("one level above the agent home"); the launcher sources
   `<agent home>/.env`. Both exist with different key sets.
4. **The bare `pi` wrapper's comment points at a path that does not exist**
   (`~/.pi/cos-orchestrator-agent/cos-orchestrator-agent/extensions/auto-sync.ts`).
5. **Two `pi` processes share the nested home** (the service and an idle VS Code TUI).
6. **`.dashboard-logs/*.pid`** are stale PID files from 2026-11-02, and the legacy
   `pi-agent.service` still exists (deliberately disabled); both are inert but confusing.
7. **`pi-cos.service` is the only Telegram poller**, but the bridge's own multi-instance
   bus means a second same-home TUI becomes a follower, not a second poller. Cross-host
   or stale-lock starts are what cause `409`.

### 2.4 `observability/` — confirmed deprecated

**Verdict: dead. Safe to archive.** Evidence:

- The producing extension is gone: there is no `~/.pi/agent/extensions/` at all, and the
  COS `extensions/` does not contain `observability`. Commit `62a1c46` ("Remove obsolete
  agent files and update `.gitignore`") deleted `agent/extensions/observability/index.ts`
  (1123 lines) on 2026-11-02.
- The sink `~/.pi/agent/observability/` holds `runs.jsonl` (3 runs, last record
  `2026-11-02T09:41:00Z`), `runs.sqlite` (3 rows in `runs`; tables `runs`, `turns`,
  `tool_calls`, plus token/lineage views), and a zero-byte WAL. No process has it open
  (`lsof` empty). The SQLite shm mtime today came from a read-only inspection, not a
  writer.
- Nothing references it: no systemd unit, timer, cron job, launcher, script or extension.
  It is gitignored and untracked.
- The real ledger is `~/.pi/agent/cos-orchestrator-agent/logs/ledger.sqlite` (last write
  2026-11-18 12:41), a different schema used by `/usage`.
- The only other mention is `shared-extensions/extensions/core/error-logger.ts`, which
  writes to `shared-extensions/extensions/observability/` (that directory does not exist)
  and is not loaded: `AGENTS.md` says "Leave `shared-extensions/` unused; this home loads
  its own files."
- The 2026-11-06 audit doc already classified it as stale session data.

Action: move `~/.pi/agent/observability/` to `~/archived-observability-20261118/` and add
a "superseded" banner to `~/.pi/docs/observability-token-lineage-setup/`. Do **not**
delete `shared-extensions/`; it is out of scope.

---

## 3. Name inventory: what changes from `cos-orchestrator-agent` to `agent`

### 3.1 Paths that literally carry the name

| # | Current path | Target | Kind | Action |
|---|---|---|---|---|
| 1 | `agent/cos-orchestrator-agent/` | `agent/` | directory (agent home) | contents merged, directory removed |
| 2 | `agent/cos-orchestrator-agent/sessions/--home-pmpmt-.pi-agent-cos-orchestrator-agent--/` | same name | session history (cwd-derived) | **not renamed** — historical directory name |
| 3 | `~/.pi/agent#copy/cos-orchestrator-agent/` | unchanged | 359 MB safeguard snapshot | **owner-owned and gitignored**; the plan ignores it, the owner deletes it later |
| 4 | `~/.pi/cos-orchestrator-agent/` | `~/retired-pi-cos-orchestrator-20261102-leftover/` | leftover from a botched copy | archive/delete; contains only stale `tmp/pi-telegram` |
| 5 | `~/.local/bin/pi-cos-orchestrator-agent` | keep name | launcher | **content updated** (home → `~/.pi/agent`), name kept |
| 6 | `~/.pi/docs/migrate_cos-orchestrator-agent-to-agent/` | keep (given by owner) | this plan | exception to the rename rule |
| 7 | `~/pi-cos-migration-20261106-162626/` | untouched | retired migration bundle | archive |
| 8 | `~/retired-pi-cos-orchestrator-agent-20261102/` | untouched | retired home | archive |
| 9 | `~/.config/systemd/user/pi-cos.service` | keep name | unit | no rename; `ExecStart` unchanged |
| 10 | `~/pi-service/pi-cos-supervisor.sh` | keep name | supervisor | **content updated** (AGENT_DIR) |
| 11 | `apps-scripts/svg-scripts/input-path/input-path.svg` | regenerate | generated image containing the old path | cosmetic |
| 12 | `apps-scripts/svg-scripts/repo-backbone/repo-backbone.svg` | regenerate | generated image | cosmetic |

The launcher filename and the systemd unit name are **kept**. They name the role, not the
home, and renaming them would require unit edits and muscle-memory changes for no gain.
The agent's display name stays "COS orchestrator / chief of staff" everywhere.

### 3.2 Document files under the home that move to `agent/…`

This is the literal answer to "write down the names of all document files that have the
name `cos-orchestrator-agent`". These are **all 49 tracked `.md` files** under
`agent/cos-orchestrator-agent/`; each keeps its relative path and loses the
`cos-orchestrator-agent/` segment:

```
cos-orchestrator-agent/AGENTS.md ......................... → agent/AGENTS.md
cos-orchestrator-agent/APPEND_SYSTEM.md .................. → agent/APPEND_SYSTEM.md
cos-orchestrator-agent/docs/CHEATSHEET.md ................ → agent/docs/CHEATSHEET.md
cos-orchestrator-agent/docs/INBOX.md ..................... → agent/docs/INBOX.md
cos-orchestrator-agent/docs/NOTES.md ..................... → agent/docs/NOTES.md
cos-orchestrator-agent/docs/documented-from-session/… (13) → agent/docs/documented-from-session/… (same names)
cos-orchestrator-agent/docs/reference/linux-user-sudo-notes.md
cos-orchestrator-agent/docs/reference/reminder-node-enabled.md
cos-orchestrator-agent/docs/runbooks/… (19) .............. → agent/docs/runbooks/… (same names)
cos-orchestrator-agent/prompts/document.md ............... → agent/prompts/document.md
cos-orchestrator-agent/prompts/dump.md ................... → agent/prompts/dump.md
cos-orchestrator-agent/prompts/explore-pi.md ............. → agent/prompts/explore-pi.md
cos-orchestrator-agent/prompts/readocs.md ................ → agent/prompts/readocs.md
cos-orchestrator-agent/prompts/short.md .................. → agent/prompts/short.md
cos-orchestrator-agent/prompts/svg-photo-convert.md ...... → agent/prompts/svg-photo-convert.md
cos-orchestrator-agent/skills/agent-creator/SKILL.md ..... → agent/skills/agent-creator/SKILL.md
cos-orchestrator-agent/skills/svg-photo-convert/… (3) .... → agent/skills/svg-photo-convert/…
```

The complete, numbered list is **Appendix A**. Submodule skills (`agent-replica-adapt`,
`pi-prompt-dump`, `skill-creator`, `video-finder`, `yt-download`) move their worktrees
with the directory; their own `.md` files are not tracked by this repo.

Non-document files that also lose the segment: `agent.json`, `package.json`,
`tsconfig.json`, `settings.json`, and every code file in `extensions/`, `src/`, `ledger/`,
`test/`, `dashboard/`, `scripts/`.

### 3.3 Documents outside the home that mention the old name

Tracked (15):

| File | Disposition |
|---|---|
| `agent/README.md` | **rewrite** (layout tree) |
| `agent-template-new-agent/template-new-agent/docs/CALLING.md` | **rewrite** the COS path (template contract) |
| `docs/pi-state-summary.md` | **rewrite** (living map) |
| `docs/pi-state-of-jev.md` | **rewrite** path mentions, or mark historical |
| `docs/explore-discover/01-extension-discovery.md` | **rewrite** path examples |
| `docs/explore-discover/02-event-lifecycle.md` | **rewrite** path examples |
| `.cursor/plans/agent_docs_sync_32cb4edb.plan.md` | leave (historical Cursor plan) |
| `.cursor/plans/append_input_phrase_edbeac89.plan.md` | leave |
| `.cursor/plans/ask_modes_and_flags_f063ccd3.plan.md` | leave |
| `.cursor/plans/cos_sibling_roster_e651e79b.plan.md` | leave |
| `.cursor/plans/project_dashboard_5b3b8f53.plan.md` | leave |
| `.cursor/plans/prompt_build_options_9a20c9ec.plan.md` | leave |
| `.cursor/plans/reminder_writer_split_7ba8c9be.plan.md` | leave |
| `.cursor/plans/slash_command_help_09b26e97.plan.md` | leave |
| `.cursor/plans/word_count_gate_7d1b76b2.plan.md` | leave |

Untracked / submodule:

| File | Disposition |
|---|---|
| `jev-classifier/docs/jev-classification-placement.md` | submodule; optional — edit and commit in `jev-classifier` if it claims the current home |
| `docs/migrate_cos-orchestrator-agent-to-agent/migrate_cos-orchestrator-agent-to-agent.md` | this plan; keep |
| `~/.pi/agent/docs/documented-from-session/**` (13 files) | **history — do not rewrite**; add one banner line in `agent/docs/CHEATSHEET.md` instead |
| `~/.pi/agent/docs/INBOX.md` | append a migration entry, do not rewrite older entries |

Also to update (not `.md`): `apps-scripts/svg-scripts/input-path/input-path.py` (hardcodes
`Path.home()/".pi"/"agent"/"cos-orchestrator-agent"`), `xtra/bash-system-scripts/start-dashboards.sh`,
`control/agents.ts`, `control/*.test.ts`, `control/tsconfig.json`, `.gitmodules`,
`.gitignore`, `.cursor/rules/do-not-reintroduce-fixed-lapses.mdc`,
`agent/cos-orchestrator-agent/skills/agent-creator/scripts/scaffold.ts`.

### 3.4 Code identifiers containing the string

These are not paths and should **not** be blindly renamed:

| File | Identifier | Decision |
|---|---|---|
| `extensions/chat/index.ts` | `customType: "cos-orchestrator-agent"` / `"cos-orchestrator-agent-usage"` | **keep** — persisted in session JSONL; renaming breaks rendering of old messages |
| `src/jev-classify.ts` | `Symbol.for("cos-orchestrator-agent.jev-classify")` | keep; in-process registry key |
| `src/mode-ack.ts` | `Symbol.for("cos-orchestrator-agent.mode-ack")` | keep |
| `src/report.ts` | `[cos-orchestrator-agent]` prefix | optional cosmetic change to `[cos]`; not required |
| `dashboard/public/index.html` | `<title>cos-orchestrator-agent</title>` | optional cosmetic |
| `dashboard/server.ts` | startup banner | optional cosmetic |
| `dashboard/public/app.js` | header comment | optional cosmetic |
| `agent.json` | `"name": "cos-orchestrator-agent"` | **decision D2** — keep as identity, or rename to `cos` |
| `skills/agent-creator/scripts/scaffold.ts` | `COS_AGENT_DIR`, replacement strings | **must update** (points at the path) |

### 3.5 `sitecustomize` check

The system `/etc/python3.12/sitecustomize.py` exists, but neither it nor anything under
`~/.local` or `~/scripts` references the old home. Nothing to change there.

---

## 4. Target layout

```
~/.pi/agent/                            PI_CODING_AGENT_DIR (default)
├── .env                                merged: default keys + TELEGRAM_BOT_TOKEN (0600)
├── .env.example                        unchanged (already describes this layout)
├── .gitignore                          merged; nested-cos rules removed
├── AGENTS.md                           moved; paths rewritten
├── APPEND_SYSTEM.md                    moved; env/launch lines rewritten
├── README.md                           rewritten layout tree
├── agent.json                          contract → ~/.pi/agent/AGENTS.md
├── auth.json                           unchanged ({})
├── bin/                                fd + gog (already the superset)
├── dashboard/                          moved (server.ts + public/)
├── docs/                               moved (CHEATSHEET, INBOX, NOTES, reference, runbooks, documented-from-session)
├── events.log                          moved (secret-scrubber runtime log)
├── extensions/                         moved (18 entries; imports down one level)
├── ledger/                             moved (env.ts refactored)
├── logs/
│   ├── ledger.sqlite (+ -wal, -shm)    moved from COS
│   └── gog-*.{log,jsonl,streak}        kept (gog keepalive)
├── models-store.json                   kept (newer, 2026-11-18 12:29)
├── node_modules/                       moved from COS (187 MB)
├── npm/                                kept (superset; @llblab/pi-telegram 0.58.3 present)
├── package-lock.json                   moved
├── package.json                        moved; `../../control` → `../control`
├── pi-web-access/                      unchanged
├── prompts/                            moved (6 prompt templates)
├── scripts/                            moved (gog scripts, svg scripts, fetch-publications)
├── sessions/                           merged (old flat + COS)
├── settings.json                       COS content wins (extensions, packages, models)
├── skills/                             moved (5 submodules + 2 plain dirs)
├── src/                                moved (25 .ts; control imports down one level)
├── state/prompt-capture/               moved (runtime, gitignored)
├── telegram.json                       COS content wins (correct `$TELEGRAM_BOT_TOKEN`)
├── test/                               moved (24)
├── tmp/pi-telegram/                    COS runtime wins; old flat one archived
├── trust.json                          union of trusted paths
└── tsconfig.json                       moved
```

No `cos-orchestrator-agent/` directory remains. No `observability/` remains.

---

## 5. Conflict matrix (file by file)

| Target | Source | Resolution | Reason |
|---|---|---|---|
| `.env` | COS `.env` | **merge**: keep default-only keys (`GOG_*`, `GDRIVE_BACKUPS_FOLDER`, `GOOGLE_PASSWORD`, `POSTGRES_CENTCOMPRAS_HASH`, `RETENTION_COUNT`, `USE_HOSTNAME_SUBFOLDER`, `AGENT_BROWSER_ARGS`, `PI_SESSION_SUMMARIES_PATH`), add `TELEGRAM_BOT_TOKEN`; on overlap **COS wins** | COS is the live instance; default supply the service keys |
| `settings.json` | COS | **replace** (tracked; `git mv -f`) | 65-line real config vs 3-line changelog stub |
| `telegram.json` | COS | **replace** | COS: `$TELEGRAM_BOT_TOKEN`; default: typo `$TELEGRAM_BOT_TOKE_N` and no token |
| `trust.json` | both | **union**: `/home/pmpmt`, `/home/pmpmt/.pi`, `/home/pmpmt/.pi/agent` | both paths are legitimately trusted |
| `auth.json` | both | keep default (`{}` in both) | identical |
| `models-store.json` | both | keep default (12:29, newer than COS 11:37) | cache; ignored |
| `pid`-less `npm/` | both | keep default (superset) after `cmp` of `@llblab/pi-telegram/dist/api/delivery.js` | COS adds nothing; default already has telegram 0.58.3 |
| `bin/` | both | keep default (`fd` + `gog`); verify `cmp bin/fd` and drop COS `bin/` | superset |
| `logs/` | both | keep default `gog-*`; move COS `ledger.sqlite*` in | no name clash |
| `sessions/` | both | merge by `rsync --ignore-existing`; keep all files | UUID names do not collide |
| `tmp/pi-telegram/` | both | archive default's stale 2026-11-02 dir; **COS wins** | COS holds the live bridge state |
| `state/` | COS | move | default has no `state/` |
| `observability/` | default | archive to `~/archived-observability-20261118/` | dead (§2.4) |
| `agent#copy/` | default | **ignore** — already renamed to `~/.pi/agent#copy/` and added to `.gitignore` by the owner | owner-owned safeguard; will be deleted later |
| `events.log` | COS | move | runtime log, ignored by `*.log` |
| `node_modules/` | COS | move | target has none |
| `package-lock.json` | COS | move | ignored by root `.gitignore` |
| `cos-orchestrator-agent/` | — | remove after moves | must be empty |
| `~/.pi/cos-orchestrator-agent/` | — | archive/delete | leftover from 2026-11-02, only stale `tmp/pi-telegram` |

---

## 6. Code and config changes (the part that is not a simple move)

### 6.1 TypeScript imports — one level too deep after the move

The home moves up one directory, so every import that leaves the home loses one `../`.
13 files under `extensions/*/index.ts` use `../../src/` and `../../ledger/`; one file
(`extensions/cron.ts`) uses `../../../cron/`; two files under `src/` use
`../../../control/`.

```bash
cd ~/.pi/agent
grep -rl 'from "\.\./\.\./src/'    extensions | xargs sed -i 's|from "\.\./\.\./src/|from "../src/|g'
grep -rl 'from "\.\./\.\./ledger/' extensions | xargs sed -i 's|from "\.\./\.\./ledger/|from "../ledger/|g'
sed -i 's|from "\.\./\.\./\.\./cron/|from "../../cron/|g' extensions/cron.ts
sed -i 's|from "\.\./\.\./\.\./control/|from "../../control/|g' src/prompt-build.ts src/input-phrase.ts
```

Post-check (all must print nothing):

```bash
grep -rn 'from "\.\./\.\./\.\./' src extensions ledger dashboard test
grep -rn 'from "\.\./\.\./\(src\|ledger\)/' extensions
grep -rn 'from "\.\./\.\./\.\./control/' src
```

Files known to contain the external imports:

```
extensions/archive/index.ts
extensions/calendar-node/index.ts
extensions/chat/index.ts
extensions/input-contains-email/index.ts
extensions/input-contains-path/index.ts
extensions/input-contains-url/index.ts
extensions/input-phrase/index.ts
extensions/jev-feedback/index.ts
extensions/less-than-input-words/index.ts
extensions/mode-switch/index.ts
extensions/prompt-build/index.ts
extensions/reminder-commands/index.ts
extensions/reminder-node/index.ts
extensions/cron.ts                      (../../../cron)
src/prompt-build.ts                     (../../../control)
src/input-phrase.ts                     (../../../control)
```

### 6.2 `ledger/env.ts` — the "repo root" collapses into the home

Current:

```ts
agentDir()  = ~/.pi/agent/cos-orchestrator-agent
repoRoot()  = ~/.pi/agent              // ".env and rate card, one level above"
```

After the move, `.env` and `model-rates.json` live **in** the agent home. If `repoRoot()`
simply becomes `path.dirname(agentDir())`, it becomes `~/.pi`, which breaks
`global-config.ts` (`repoRoot/../config.json` would become `/home/pmpmt/config.json`) and
moves the rate card.

Required refactor (recommended):

```ts
export function agentDir(env) { ... }                 // ~/.pi/agent
export function piRoot(env) { return path.dirname(agentDir(env)); }   // ~/.pi
// rateCardPath:   path.join(agentDir(env), "model-rates.json")
// modelsStorePath: unchanged
// sessionsRoot:   unchanged
// ledgerPath:     unchanged
```

Call sites to update from `repoRoot(env)`:

| File | New expression |
|---|---|
| `ledger/env.ts` `rateCardPath` | `path.join(agentDir(env), "model-rates.json")` |
| `src/global-config.ts` (3 functions) | `path.resolve(piRoot(env), "config.json")`, `"input-phrase-config.json"`, `"prompt-build-config.json"` |
| `src/mode-switch.ts` | `path.join(piRoot(env), "control", "cli.ts")` |

`repoRoot` is then deleted. Update the `env.ts` fallback string to
`path.join(env.HOME ?? "", ".pi", "agent")`; this is the exact string
`skills/agent-creator/scripts/scaffold.ts` rewrites when generating a sibling, so update
its `replace()` target too.

### 6.3 `src/telegram-delivery.ts`

Fallback path for the bridge's delivery module:

```ts
// before: ~/.pi/agent/cos-orchestrator-agent/npm/node_modules/@llblab/...
// after:  ~/.pi/agent/npm/node_modules/@llblab/pi-telegram/dist/api/delivery.js
```

The target `npm/` already has `@llblab/pi-telegram@0.58.3` with `dist/api/delivery.js`.

### 6.4 `package.json`

```diff
- "test:dashboard": "node --experimental-strip-types --test ../../control/*.test.ts",
- "typecheck": "tsc --noEmit && tsc -p ../../control/tsconfig.json",
+ "test:dashboard": "node --experimental-strip-types --test ../control/*.test.ts",
+ "typecheck": "tsc --noEmit && tsc -p ../control/tsconfig.json",
```

### 6.5 Control plane (`~/.pi/control/`)

| File | Change |
|---|---|
| `control/agents.ts` | cos row `home: "agent"` (was `"agent/cos-orchestrator-agent"`) |
| `control/cli.test.ts` | fixture key `"agent/cos-orchestrator-agent"` → `"agent"` (2 places) |
| `control/store.test.ts` | `path.join(root, "agent/cos-orchestrator-agent")` → `"agent"`; settings path likewise |
| `control/tsconfig.json` | `typeRoots: ["../agent/node_modules/@types"]` |

Run the control tests after the edit: they construct temporary roots with the same layout.

### 6.6 Scripts

| File | Change |
|---|---|
| `scripts/gog-token-keepalive.sh` | `AGENT_HOME="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"`; `load_env "$HOME/.pi/agent/.env"` stays, second `load_env` becomes the same file (keep, idempotent) |
| `scripts/gog-keepalive-day8.sh` | same `AGENT_HOME`; `load_env "$HOME/.pi/agent/.env"` |
| `scripts/downloads-inventory.sh`, `downloads-reclaim.sh` | no home dependency (verify with grep) |
| `apps-scripts/svg-scripts/input-path/input-path.py` | line 526 `Path.home()/".pi"/"agent"`; line 239 skip set may drop the `cos-orchestrator-agent` names |
| `xtra/bash-system-scripts/start-dashboards.sh` | `orch="$root/agent"` |

### 6.7 Launcher and supervisor

`~/.local/bin/pi-cos-orchestrator-agent`:

```diff
- export PI_CODING_AGENT_DIR="$HOME/.pi/agent/cos-orchestrator-agent"
+ export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
```

and the header comment (`Home: ~/.pi/agent`). Keep the pre-start `git pull`, the model
file block (`default-model.json`), and the launcher name.

`~/pi-service/pi-cos-supervisor.sh`:

```diff
- AGENT_DIR="$HOME/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent"
+ AGENT_DIR="$HOME/.pi/agent"
```

This also fixes the "wait for previous instance" guard. Adjust the comment block that
mentions `agent-cos-orchestrator-agent`.

`~/.local/bin/pi` (the bare wrapper): update only the stale comment that points at
`~/.pi/cos-orchestrator-agent/cos-orchestrator-agent/extensions/auto-sync.ts`. It already
sources `~/.pi/agent/.env`, which is now the right file.

### 6.8 systemd units

Edit two user units, then `systemctl --user daemon-reload`:

```diff
# ~/.config/systemd/user/gog-token-keepalive.service
- ExecStart=/home/pmpmt/.pi/agent/cos-orchestrator-agent/scripts/gog-token-keepalive.sh
+ ExecStart=/home/pmpmt/.pi/agent/scripts/gog-token-keepalive.sh

# ~/.config/systemd/user/gog-keepalive-day8.service
- ExecStart=/home/pmpmt/.pi/agent/cos-orchestrator-agent/scripts/gog-keepalive-day8.sh
+ ExecStart=/home/pmpmt/.pi/agent/scripts/gog-keepalive-day8.sh
```

`pi-cos.service` does not change. The `.bak-*` unit copies are historical; leave them.

### 6.9 Git metadata

`.gitmodules` — five entries, all prefixed `agent/cos-orchestrator-agent/skills/`:

```diff
- [submodule "agent/cos-orchestrator-agent/skills/agent-replica-adapt"]
- 	path = agent/cos-orchestrator-agent/skills/agent-replica-adapt
+ [submodule "agent/skills/agent-replica-adapt"]
+ 	path = agent/skills/agent-replica-adapt
...
```

(and the same for `pi-prompt-dump`, `skill-creator`, `video-finder`, `yt-download`)

After moving, repair the absorbed gitdirs and sync:

```bash
cd ~/.pi
for n in agent-replica-adapt pi-prompt-dump skill-creator video-finder yt-download; do
  printf 'gitdir: ../../../.git/modules/agent/cos-orchestrator-agent/skills/%s\n' "$n" \
    > "agent/skills/$n/.git"
  git config -f ".git/modules/agent/cos-orchestrator-agent/skills/$n/config" \
    core.worktree "../../../../../../agent/skills/$n"
done
git submodule sync --recursive
git submodule status --recursive           # all five clean at their pinned commits
```

`.gitignore`:

- delete `agent/cos-orchestrator-agent/state/` (the earlier `agent/state/prompt-capture/`
  rule already covers the flat layout);
- keep `agent/bin/`, `agent/npm/`, `agent/tmp/`, `agent/pi-web-access/`,
  `agent/observability/` (or drop the observability block after archiving);
- keep `**/sessions/`, `models-store.json`, `**/telegram.json`, `*.sqlite*`;
- `agent#copy/` is already in `.gitignore` (owner edit); leave it there. The plan does not
  touch the snapshot.

`agent/.gitignore` (the tracked one inside the home): it already ignores `logs/`,
`sessions/`, `node_modules/`, `package-lock.json`, `default-model.json`,
`front-and-center.md`, `.env`, `auth.json`, `models-store.json`, `model-rates.json`,
`*.tmp`, `*.log`. No change needed, but confirm after the move that it does not shadow
anything that must stay tracked.

### 6.10 Bulk find/replace policy for docs

For **live** docs (not history), replace:

```
/home/pmpmt/.pi/agent/cos-orchestrator-agent  → /home/pmpmt/.pi/agent
~/.pi/agent/cos-orchestrator-agent            → ~/.pi/agent
agent/cos-orchestrator-agent                  → agent
```

Do **not** run this across `docs/documented-from-session/**`, `.cursor/plans/**`, or
`agent/docs/INBOX.md` history sections. Do not rewrite `~/.pi/agent/sessions/**` or
`tmp/pi-telegram/logs.jsonl` — those are records.

---

## 7. Execution runbook

> All commands run as `pmpmt`; **no sudo** is required (every path is user-owned).
> Do not run any `pi` process in the agent home between Phase 2 and Phase 6: the
> `auto-sync` extension commits and pushes the whole repo on shutdown.

### Phase 0 — baseline, before touching the service

**Move-only policy.** The migration itself never copies: every step is `git mv`, `mv`, or
`rsync --remove-source-files` for the session merge. Files the target already owns are
moved to `~/pi-migration-leftovers-20261118/` instead of being deleted, so the source
home shows exactly what was left at the end. The only safeguard is the owner's snapshot
at `~/.pi/agent#copy/` (already renamed from `#agent#copy` and added to `.gitignore`); it
is ignored by this plan and the owner will delete it later.

```bash
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M%S)

# 0.1 record the baseline
cd ~/.pi
git status --short > ~/premerge-$STAMP-git-status.txt
git rev-parse HEAD > ~/premerge-$STAMP-head.txt

# 0.2 checkpoint the pre-existing dirt: settings changelog, INBOX launcher audit,
#     the owner's agent#copy .gitignore rule, and this plan
git add -A
git commit -m "chore: checkpoint before flattening the cos home (settings, inbox, plan)"
```

`auto-sync.ts` runs `git add -A` on shutdown. With `agent#copy/` ignored and the tree
clean, that shutdown commit is a no-op. Do not run a `pi` in the home after Phase 2 until
the migration commit exists.

### Phase 1 — freeze

```bash
# OWNER ACTION: the owner owns the service lifecycle in this run.
systemctl --user stop pi-cos.service
systemctl --user is-active pi-cos.service || true    # expect: inactive/dead

# the VS Code TUI must be closed by the owner; verify:
for p in $(pgrep -x pi); do
  printf '%s: ' "$p"
  tr '\0' '\n' < /proc/$p/environ | grep -qx \
    "PI_CODING_AGENT_DIR=$HOME/.pi/agent/cos-orchestrator-agent" \
    && echo "STILL RUNNING (close it)" || echo "not the cos home"
done
```

Do not proceed while any PID still resolves to the nested home. This session (own home
`~/.pi/agent`) may stay open; it is not the service.

### Phase 2 — move the home contents

Run from `~/.pi/agent`. `S=cos-orchestrator-agent`.

```bash
cd ~/.pi/agent
S=cos-orchestrator-agent

# 2.1 tracked trees: git mv keeps rename detection
git mv $S/extensions          extensions
git mv $S/ledger              ledger
git mv $S/src                 src
git mv $S/test                test
git mv $S/prompts             prompts
git mv $S/scripts             scripts
git mv $S/dashboard           dashboard
git mv $S/skills              skills
git mv $S/docs                docs
git mv $S/AGENTS.md           AGENTS.md
git mv $S/APPEND_SYSTEM.md    APPEND_SYSTEM.md
git mv $S/agent.json          agent.json
git mv $S/package.json        package.json
git mv $S/tsconfig.json       tsconfig.json
git mv -f $S/settings.json    settings.json     # overwrite the 3-line stub

# 2.2 runtime / ignored
mv $S/node_modules            node_modules
mv $S/package-lock.json       package-lock.json
mv $S/state                   state
mv $S/events.log              events.log
mv $S/logs/ledger.sqlite      logs/ledger.sqlite
mv $S/logs/ledger.sqlite-wal  logs/ledger.sqlite-wal
mv $S/logs/ledger.sqlite-shm  logs/ledger.sqlite-shm

mkdir -p ~/pi-migration-leftovers-20261118

# 2.3 sessions merge — move files, leave collisions in the source for inspection
rsync -a --ignore-existing --remove-source-files $S/sessions/ sessions/
find $S/sessions -depth -type d -empty -delete

# 2.4 Telegram runtime: COS wins, default's 2026-11-02 snapshot is archived
mv tmp/pi-telegram tmp/pi-telegram.legacy-20261102
mv $S/tmp/pi-telegram tmp/pi-telegram
rmdir $S/tmp

# 2.5 telegram.json and trust.json
mv -f $S/telegram.json telegram.json
# trust.json: write the union, then drop the duplicate
cat > trust.json <<'JSON'
{
  "/home/pmpmt": true,
  "/home/pmpmt/.pi": true,
  "/home/pmpmt/.pi/agent": true
}
JSON
mv $S/trust.json ~/pi-migration-leftovers-20261118/cos-trust.json

# 2.6 duplicates the target already owns: move them to leftovers, do not delete
cmp -s bin/fd $S/bin/fd && mv $S/bin ~/pi-migration-leftovers-20261118/cos-bin
cmp -s npm/node_modules/@llblab/pi-telegram/dist/api/delivery.js \
       $S/npm/node_modules/@llblab/pi-telegram/dist/api/delivery.js \
  && mv $S/npm ~/pi-migration-leftovers-20261118/cos-npm
mv $S/auth.json $S/models-store.json ~/pi-migration-leftovers-20261118/

# 2.7 .env merge (Appendix C). The script moves both originals to the leftovers
#     folder first, then writes the merged ~/.pi/agent/.env with mode 600.

# 2.8 anything still in $S is a leftover: list it, decide, then remove the empty dir
find $S -mindepth 1 -maxdepth 2
# Expected: nothing. If files remain they are collisions or a missed step; report them,
# do not `rm -rf` them. When empty:
rmdir $S
```

Note: `git mv -f` is the one command that overwrites a tracked destination. Everything
else either has no destination or is merged deliberately.

### Phase 3 — rewrite paths inside code

Run §6.1, §6.2, §6.3, §6.4 exactly. Then:

```bash
cd ~/.pi/agent
npm run typecheck
npm test
```

Do not start a `pi` yet; tests are enough for this phase. `npm run typecheck` covers the
control plane too. If typecheck fails on an import, the sed pass missed a depth — fix it
before continuing.

### Phase 4 — config outside the home

Run §6.5 (control plane), §6.6 (scripts), §6.7 (launcher + supervisor), §6.8 (units +
`daemon-reload`), §6.9 (`.gitmodules`, gitdir repair, `.gitignore`).

Verify the launcher's env still resolves:

```bash
bash -n ~/.local/bin/pi-cos-orchestrator-agent
bash -n ~/pi-service/pi-cos-supervisor.sh
bash -n ~/.pi/agent/scripts/gog-token-keepalive.sh
bash -n ~/.pi/agent/scripts/gog-keepalive-day8.sh
systemctl --user daemon-reload
systemctl --user cat gog-token-keepalive.service | grep ExecStart
systemctl --user cat gog-keepalive-day8.service | grep ExecStart
```

### Phase 5 — docs

Run §6.10 for the live docs listed in §3.2/§3.3:

1. `agent/AGENTS.md` — home, credentials, launch, and flip the "Do not describe
   `~/.pi/agent/extensions/` as current" sentence (it is current again).
2. `agent/APPEND_SYSTEM.md` — home, creds (same directory), launch, rate card.
3. `agent/agent.json` — `contract: "~/.pi/agent/AGENTS.md"`; `name` stays (decision D2).
4. `agent/README.md` — layout tree; also fix the stale `~/pi-agents-experts-grouped/`
   paragraph while there.
5. `agent/docs/CHEATSHEET.md` — paths; add a one-line banner that
   `docs/documented-from-session/**` is historical.
6. Live runbooks under `agent/docs/runbooks/**` — only the ones that claim a current path.
7. `agent/prompts/document.md`, `agent/skills/agent-creator/SKILL.md` and
   `agent/skills/agent-creator/scripts/scaffold.ts` (§6.2 replacement string).
8. `docs/pi-state-summary.md` — quick facts, agents table, submodules, file map, replica
   hosts.
9. `~/AGENTS.md` (machine-local, untracked) — Runtime Layout, Telegram Bridge,
   Repository Sync; keep the "legacy `pi-agent.service` stays disabled" warning, and
   restate the one-poller rule in same-host terms: the bridge's multi-instance bus makes
   extra local TUIs followers, while a second host or a stale lock is what causes `409`.
10. `.cursor/rules/do-not-reintroduce-fixed-lapses.mdc` — reference path.
11. `agent-template-new-agent/template-new-agent/docs/CALLING.md`, `docs/explore-discover/*`,
    `docs/pi-state-of-jev.md` — path mentions.
12. Append a "Home flattened 2026-11-18" entry to `agent/docs/INBOX.md`; do not rewrite
    older entries.

### Phase 6 — commit

```bash
cd ~/.pi
git add -A
git status --short | head -60          # expect R + M, no runtime dirs
git diff --cached --stat | tail -5
git commit -m "refactor(agent-home): flatten cos-orchestrator-agent into ~/.pi/agent"
```

Do **not** push yet. Push after Phase 8 passes.

### Phase 7 — offline verification

```bash
cd ~/.pi/agent
npm run typecheck
npm test
npm run test:dashboard                # control plane tests, ../control
```

Check the ledger without starting the bridge:

```bash
cd ~/.pi/agent
set -a; source ~/.pi/agent/.env; unset TELEGRAM_BOT_TOKEN; set +a
PI_CODING_AGENT_DIR=$HOME/.pi/agent \
  ~/.nvm/versions/node/v24.21.0/bin/pi -p '/usage'
```

`TELEGRAM_BOT_TOKEN` is unset only for this command so a transient `pi` cannot poll the
bot. The tree is already committed, so even if auto-sync runs on shutdown it is a no-op.

### Phase 8 — go live (owner action)

The owner restarts the service; this session does not call `systemctl start`.

```bash
systemctl --user start pi-cos.service
sleep 20
tmux -L pi-cos capture-pane -p -t pi-cos | tail -8     # expect "telegram connected"
journalctl --user -u pi-cos -n 40 --no-pager
```

Then, from Telegram, send `/usage` and one normal message. Confirm:

- exactly one `pi` process with `PI_CODING_AGENT_DIR=/home/pmpmt/.pi/agent`;
- the ledger gains a row (`sqlite3 ~/.pi/agent/logs/ledger.sqlite 'select count(*) from runs;'`);
- `/usage` renders from the new home;
- scheduler/reminder hooks still load (watch the startup extension lines);
- `systemctl --user list-timers 'gog-*'` still shows both timers.

Only after that:

```bash
cd ~/.pi && git push
```

### Phase 9 — cleanup

```bash
# 9.1 observability (dead, §2.4)
mv ~/.pi/agent/observability ~/archived-observability-20261118/
# add the superseded banner to ~/.pi/docs/observability-token-lineage-setup/...md
# optionally delete the agent/observability block from .gitignore

# 9.2 leftover empty/botched dirs
mv ~/.pi/cos-orchestrator-agent ~/retired-pi-cos-orchestrator-20261102-leftover/

# 9.3 inspect what the migration left behind, then keep or delete
ls -la ~/pi-migration-leftovers-20261118/
#    Keep until the owner signs off. The owner's ~/.pi/agent#copy/ safeguard is theirs:
#    do not touch or delete it.
```

Do not touch `~/retired-pi-cos-orchestrator-agent-20261102/` or
`~/pi-cos-migration-20261106-162626/`; they are archives.

---

## 8. Verification checklist

- [ ] No process has `PI_CODING_AGENT_DIR` under `cos-orchestrator-agent`.
- [ ] `test ! -e ~/.pi/agent/cos-orchestrator-agent`.
- [ ] `stat -c '%a' ~/.pi/agent/.env` is `600`; `grep -c TELEGRAM_BOT_TOKEN` = 1.
- [ ] `jq . ~/.pi/agent/settings.json` parses; extensions paths resolve from `~/.pi/agent`.
- [ ] `npm run typecheck` exit 0.
- [ ] `npm test` exit 0.
- [ ] `npm run test:dashboard` exit 0.
- [ ] `pi -p '/usage'` prints a table (no bridge).
- [ ] `git submodule status --recursive` shows 6 entries (5 skills + `jev-classifier`), all clean.
- [ ] `git status` clean except ignored runtime.
- [ ] `systemctl --user is-active pi-cos.service` = active.
- [ ] tmux pane says `telegram connected`.
- [ ] Telegram echo test succeeds; `/usage` answers.
- [ ] `~/.pi/agent/logs/ledger.sqlite` row count grew.
- [ ] `gog-*` timers still loaded and point at `~/.pi/agent/scripts/...`.
- [ ] `pi-config list` shows the cos row with home `agent`.
- [ ] Dashboard `:8787` starts from `~/.pi/agent` (manual check, optional).
- [ ] `docs/pi-state-summary.md` and `~/AGENTS.md` agree with reality.

---

## 9. Rollback

Two backstops, both already exist:

1. `~/.pi/agent#copy/` — the owner's full snapshot of `~/.pi/agent` from 2026-11-18 12:47,
   now gitignored. The owner keeps it as a safeguard and will delete it later; this plan
   does not touch it.
2. The Phase 0.2 checkpoint commit — tracked files only.

Rollback procedure:

```bash
systemctl --user stop pi-cos.service          # owner

# keep the broken result for inspection
mv ~/.pi/agent ~/pi-agent-failed-$(date +%Y%m%d-%H%M%S)
mv ~/.pi/agent#copy ~/.pi/agent                # your safeguard becomes the live home

# restore the repo state (the checkpoint commit from Phase 0.2)
cd ~/.pi
git reset --hard <phase-0-commit>
systemctl --user start pi-cos.service          # owner
tmux -L pi-cos capture-pane -p -t pi-cos | tail -8
```

The git reset is safe only for tracked files; runtime state comes from the snapshot. Do
not `git clean -fdx` — it would delete the machine-local `.env`, `telegram.json`,
sessions and ledger.

If only the service is broken after a successful migration, the problem is almost always
one of: launcher `PI_CODING_AGENT_DIR`, supervisor `AGENT_DIR`, a stale Telegram lock, or
a missed import depth. Check `journalctl --user -u pi-cos -n 60` and
`tmux -L pi-cos capture-pane -p -t pi-cos` first.

---

## 10. Risks and open hazards

| # | Risk | Mitigation |
|---|---|---|
| 1 | ~~`auto-sync` commits `#agent#copy/`~~ | **resolved by owner 2026-11-18**: renamed to `~/.pi/agent#copy/` and added to `.gitignore`; the plan ignores it |
| 2 | A second Telegram poller causes `409` | service stopped throughout; verification unsets `TELEGRAM_BOT_TOKEN`; only one host |
| 3 | `git mv` breaks the 5 skill submodules | repair `gitdir` + `core.worktree`, `git submodule sync`, verify status |
| 4 | Missed import depth | `npm run typecheck` + the grep post-checks in §6.1 |
| 5 | `repoRoot()` silently moves `config.json` to `~` | refactor to `piRoot()`/`agentDir()` (§6.2) and test `pi-config` |
| 6 | Stale bridge state (`journalPath` under the dead path) | bridge tolerates it today; if it refuses to connect, delete `tmp/pi-telegram/state.json` + `runtime/*.sock` and run `/telegram-connect` |
| 7 | The VS Code `pi` (PID 858696) keeps writing to the moved home | owner closes it; the freeze check in Phase 1 enforces it |
| 8 | Launcher pre-start `git pull` runs during a dirty migration | no `pi` runs between Phase 2 and Phase 6; commit before starting the service |
| 9 | `gog` timers fire while paths are half-edited | migration window is minutes; next fire 08:00. If needed, `systemctl --user stop gog-token-keepalive.timer` for the window |
| 10 | `npm/` superset has stale packages (`@mjakl/pi-subagent` etc.) | not loaded (settings only list `@llblab/pi-telegram`); leave or prune later |
| 11 | `GEMINI_API_KEY` is invalid in **both** env files (one dead service account, one invalid key) | not caused by the migration; record as a separate task. Do not touch the key during migration |
| 12 | docs claim the old home in ~20 places | §6.10 policy + checklist; history is intentionally left alone |

Additional facts worth recording:

- The default home's `sessions/--home-pmpmt-.pi--/` contains a 2026-11-18 12:30 session
  whose "user message" is pasted terminal output from a `pi update`; it is harmless.
- `~/.pi/agent/logs/gog-*` are written by the gog keepalive scripts; the `LOG_DIR` is
  already `~/.pi/agent/logs`, independent of the agent home.
- `~/.pi/agent/pi-web-access/last-seen-version.json` and `agent/tmp/` are runtime caches.
- The bridge's own multi-instance bus (`leaderSocketPath` / `followerSocketPath` in
  `state.json`) means multiple same-host Pi instances become followers, not extra
  pollers. This is why the idle VS Code instance did not cause a `409`.

---

## 11. Decisions needed before Phase 0

| # | Question | Recommendation |
|---|---|---|
| D1 | Confirm "yourself" = `~/.pi/agent`, i.e. flatten the COS home into it and delete the nested directory? | Yes — that is what this plan does |
| D2 | Keep the agent identity `cos-orchestrator-agent` (name, report prefix, session customType) or rename everything visible to `agent`/`cos`? | Keep the identity; rename only paths. Avoids breaking persisted session rendering |
| D3 | Archive or delete `observability/`? | Archive to `~/archived-observability-20261118/` |
| D4 | The 359 MB snapshot | **Answered:** owner renamed it to `~/.pi/agent#copy/`, added `agent#copy/` to `.gitignore`, and will delete it later. The plan ignores it. |
| D5 | Keep the launcher name `pi-cos-orchestrator-agent`? | Yes — the systemd unit and the role name depend on it |
| D6 | Who runs the service restart? | **Answered:** the owner does. This session never runs `systemctl start` (and the owner also runs the stop). |
| D7 | Rename this plan directory to `migrate-cos-to-agent/` after execution? | Optional; the owner chose the current path |
| D8 | Fix the two invalid Gemini keys as part of this change? | No — separate task |

---

## Appendix A — complete list of document files that lose the `cos-orchestrator-agent/` segment

All 49 tracked `.md` files under the nested home. Left column is the current path; the
target is the same path with `agent/cos-orchestrator-agent/` → `agent/`.

1. `AGENTS.md`
2. `APPEND_SYSTEM.md`
3. `docs/CHEATSHEET.md`
4. `docs/INBOX.md`
5. `docs/NOTES.md`
6. `docs/documented-from-session/2026-11-01T1628-sm-google-workspace-agent-setup/2026-11-01T1628-sm-google-workspace-agent-setup.md`
7. `docs/documented-from-session/2026-11-02T1754-launcher-audit-and-vps-replica-deployment/2026-11-02T1754-launcher-audit-and-vps-replica-deployment.md`
8. `docs/documented-from-session/2026-11-03T1721-lan-agent-file-server-bootstrap/2026-11-03T17-21-37-700_2026-11-03T1721-lan-agent-file-server-bootstrap.md`
9. `docs/documented-from-session/2026-11-04T0747-local-server-gpu-ollama-bringup/2026-11-04T07-47-31-000_2026-11-04T0747-local-server-gpu-ollama-bringup.md`
10. `docs/documented-from-session/2026-11-04T1010-calendar-entry-routing-node/2026-11-04T10-10-04-000_2026-11-04T1010-calendar-entry-routing-node.md`
11. `docs/documented-from-session/2026-11-04T1148-image-to-svg-detailed-rendering/2026-11-04T11-48-56-000_2026-11-04T1148-image-to-svg-detailed-rendering.md`
12. `docs/documented-from-session/2026-11-04T1209-svg-photo-convert-skill/2026-11-04T12-09-51-000_2026-11-04T1209-svg-photo-convert-skill.md`
13. `docs/documented-from-session/2026-11-05T1127-calendar-node-rename-and-write-fields/2026-11-05T11-27-00-000_2026-11-05T1127-calendar-node-rename-and-write-fields.md`
14. `docs/documented-from-session/2026-11-06T1056-keep-agent-frozen-instructions-and-usage-tracking/2026-11-06T1056-keep-agent-frozen-instructions-and-usage-tracking.md`
15. `docs/documented-from-session/2026-11-06T1632-agent-home-restore-and-rename-wiring-audit/2026-11-06T1632-agent-home-restore-and-rename-wiring-audit.md`
16. `docs/documented-from-session/2026-11-07T0744-input-phrase-append/2026-11-07T07-44-00-000_2026-11-07T0744-input-phrase-append.md`
17. `docs/documented-from-session/2026-11-07T1008-terminal-control-plane-and-mode-switch/2026-11-07T1008-terminal-control-plane-and-mode-switch.md`
18. `docs/documented-from-session/2026-11-07T1105-per-machine-control-plane-store/2026-11-07T1105-per-machine-control-plane-store.md`
19. `docs/reference/linux-user-sudo-notes.md`
20. `docs/reference/reminder-node-enabled.md`
21. `docs/runbooks/calendar-routing-on-vps.md`
22. `docs/runbooks/calendar-routing.md`
23. `docs/runbooks/gog-add-tasks-scope.md`
24. `docs/runbooks/gog-new-oauth-client.md`
25. `docs/runbooks/gog-oauth-consent-screen.md`
26. `docs/runbooks/gog-token-keepalive.md`
27. `docs/runbooks/google-keep-read-all.md`
28. `docs/runbooks/lan-server-192.168.1.60/index.md`
29. `docs/runbooks/lan-server-192.168.1.60/lan-file-server-ssh-setup.md`
30. `docs/runbooks/lan-server-192.168.1.60/lan-pmpmt-ssh-key.md`
31. `docs/runbooks/lan-server-192.168.1.60/lan-server-full-access-and-local-agent.md`
32. `docs/runbooks/lan-server-192.168.1.60/rtx3060-ollama-server-install.md`
33. `docs/runbooks/lan-server-192.168.1.60/server-pi-install.md`
34. `docs/runbooks/mode-switch.md`
35. `docs/runbooks/pi-config-terminal-toggles.md`
36. `docs/runbooks/reminder-routing.md`
37. `docs/runbooks/svg-rendering.md`
38. `docs/runbooks/vps-agent-parity.md`
39. `docs/runbooks/vps-telegram-bridge.md`
40. `prompts/document.md`
41. `prompts/dump.md`
42. `prompts/explore-pi.md`
43. `prompts/readocs.md`
44. `prompts/short.md`
45. `prompts/svg-photo-convert.md`
46. `skills/agent-creator/SKILL.md`
47. `skills/svg-photo-convert/SKILL.md`
48. `skills/svg-photo-convert/evals/README.md`
49. `skills/svg-photo-convert/references/parameters.md`

Submodule worktrees that move (their own docs are not tracked here):
`skills/agent-replica-adapt`, `skills/pi-prompt-dump`, `skills/skill-creator`,
`skills/video-finder`, `skills/yt-download`.

---

## Appendix B — documents outside the home that need a content edit

Tracked (`git grep -l 'cos-orchestrator-agent' -- '*.md'`):

- `agent/README.md` — rewrite layout; also fixes the old `~/pi-agents-experts-grouped/` text.
- `agent-template-new-agent/template-new-agent/docs/CALLING.md` — template contract.
- `docs/pi-state-summary.md` — living map (quick facts, agents table, submodules, file map).
- `docs/pi-state-of-jev.md` — path mentions.
- `docs/explore-discover/01-extension-discovery.md` — path examples.
- `docs/explore-discover/02-event-lifecycle.md` — path examples.
- `.cursor/plans/*.plan.md` (9 files) — **leave as history**.

Untracked / submodule:

- `jev-classifier/docs/jev-classification-placement.md` — optional, needs a commit in the
  `jev-classifier` submodule.
- `docs/migrate_cos-orchestrator-agent-to-agent/migrate_cos-orchestrator-agent-to-agent.md`
  — this plan.

Non-markdown config that must change (full list in §6):
`control/agents.ts`, `control/cli.test.ts`, `control/store.test.ts`,
`control/tsconfig.json`, `xtra/bash-system-scripts/start-dashboards.sh`,
`apps-scripts/svg-scripts/input-path/input-path.py`, `.gitmodules`, `.gitignore`,
`.cursor/rules/do-not-reintroduce-fixed-lapses.mdc`,
`agent/skills/agent-creator/scripts/scaffold.ts`,
`~/.local/bin/pi-cos-orchestrator-agent`, `~/.local/bin/pi` (comment),
`~/pi-service/pi-cos-supervisor.sh`, two `gog-*` systemd units, `~/AGENTS.md`.

---

## Appendix C — `.env` merge script

Run once in Phase 2.7. It never prints a value. It reads both files, **moves** the two
originals into `~/pi-migration-leftovers-20261118/`, then writes the merged
`~/.pi/agent/.env` with mode 600. No copy of a secret is left behind, and the originals
remain inspectable.

```bash
python3 - <<'PY'
import os, re

home = os.path.expanduser("~")
leftovers = os.path.join(home, "pi-migration-leftovers-20261118")
os.makedirs(leftovers, exist_ok=True)
target = os.path.join(home, ".pi/agent/.env")
source = os.path.join(home, ".pi/agent/cos-orchestrator-agent/.env")
key_re = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$")

def lines(path):
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            yield raw.rstrip("\n")

base = list(lines(target))
src = list(lines(source))
src_map = {}
for line in src:
    m = key_re.match(line)
    if m:
        src_map[m.group(1)] = m.group(2)

seen = set()
out = []
for line in base:
    m = key_re.match(line)
    if not m:
        out.append(line)
        continue
    key = m.group(1)
    seen.add(key)
    out.append(f"{key}={src_map[key]}" if key in src_map else line)

missing = [line for line in src if key_re.match(line) and key_re.match(line).group(1) not in seen]
if missing:
    out += ["", "# Merged from cos-orchestrator-agent/.env on 2026-11-18"] + missing

# Move the originals out before writing the merged file (no secret copies).
os.replace(target, os.path.join(leftovers, "dot-env.default"))
os.replace(source, os.path.join(leftovers, "dot-env.cos"))

with open(target, "w", encoding="utf-8") as fh:
    fh.write("\n".join(out) + "\n")
os.chmod(target, 0o600)
print("merged; originals in", leftovers)
PY
```

Expected key delta: `TELEGRAM_BOT_TOKEN` added; `GEMINI_API_KEY` taken from the COS file;
GOG/Google/pg/retention keys preserved from the default file.

---

## Appendix D — Telegram state note

`tmp/pi-telegram/state.json` is the bridge's last snapshot from PID 329655. After the move
it contains old paths, but the bridge rewrites the state on take-over and has tolerated a
missing `journalPath` since 2026-11-06. Do not edit it pre-emptively.

If Phase 8 shows "telegram disconnected" for more than one minute:

```bash
systemctl --user stop pi-cos.service
rm -f ~/.pi/agent/tmp/pi-telegram/state.json
rm -f ~/.pi/agent/tmp/pi-telegram/runtime/*.sock
systemctl --user start pi-cos.service
# if the status line is still dark after 30 s, the supervisor's fallback sends
# /telegram-connect into the pane; watch `tmux -L pi-cos capture-pane -p -t pi-cos`
```

This is the same stale-lock recovery the supervisor already implements.
