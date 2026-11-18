# keep-agent — Lean Sibling Agent with Frozen Instructions & Usage Tracking — Setup & Implementation Report

> Removed 2026-11-07. Do not restore. This file is the creation record only.

**Date:** 2026-11-06
**System:** Ubuntu 24.04.5 LTS (thinkpad `pmpmt-ThinkPad-T15-Gen-2i`), Pi v1.4.0, Node v24.21.0
**Location:** `~/.pi/agent-keep-agent/keep-agent/` (agent home) · `~/.pi/agent-keep-agent/.env` (keys) ·
`~/.local/bin/pi-keep-agent` (launcher) · `~/.config/systemd/user/pi-keep-agent-{ledger.timer,ledger.service,dashboard.service}` ·
contract `~/.pi/agent-keep-agent/keep-agent/docs/CALLING.md` · roster row in `~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent/APPEND_SYSTEM.md`

---

## Problem

The request started as "make a sibling based on yourself", then hardened into a specialist that
must not inherit the orchestrator's instructions:

1. Copy every capability of the CoS orchestrator agent into a new sibling.
2. `APPEND_SYSTEM.md` must be **blank**, and `AGENTS.md` must say only that the agent gets its
   instructions from the user — both frozen ("acknowledge frozen").
3. Then: **lean it down** — drop all extensions (question 3), strip the git automation
   (question 4), and *enhance* `AGENTS.md` instead of leaving a one-liner (question 8).
4. Then: remove skills as well.
5. Finally, and this reversed an earlier decision: **track token usage from day 1, conversation 1.**

Two constraints shaped everything. The new home lives inside the single `~/.pi` git repo and
shares machine-wide state with the orchestrator (`~/.pi/config.json` gates,
`~/.pi/decision-nodes/`, `reminders.jsonl`, the Telegram bot token, the dashboard port). And the
orchestrator's own instructions describe *this* machine, so a copy that keeps them is not a
specialist — it is a second chief of staff that will act on runbooks about other agents.

---

## Investigation / Root Cause

No web research was needed. The diagnosis came from reading Pi's own source under
`~/.nvm/versions/node/v24.21.0/lib/node_modules/@earendil-works/pi-coding-agent/` and from
running the copy. Each finding below was a wrong assumption until tested.

| # | Assumption | What was actually true | Evidence |
|---|---|---|---|
| 1 | Removing an extension from `settings.json` disables it | Pi **auto-discovers** every `*.ts`/`*.js` file and every subdirectory holding an `index.ts` inside `<agent-dir>/extensions/`, on top of settings entries | `dist/core/package-manager.js` → `collectAutoExtensionEntries()`: skips names starting with `.`, loads files ending `.ts`/`.js`, resolves dirs via `resolveExtensionEntries()` |
| 2 | Hiding the routing extensions on disk was therefore required | Confirmed: `settings.json` without `calendar-node` still printed `[jev] winner none none ?` on every turn | turn output before/after dot-prefixing |
| 3 | Calendar/reminder nodes could be gated per agent | The gates are global: `globalConfigPath()` resolves to `path.resolve(repoRoot(env), "..", "config.json")` → `~/.pi/config.json`, shared by every agent home | `src/global-config.ts`, `ledger/env.ts` |
| 4 | A second agent can reuse the existing Telegram token | One polling owner per bot token; a second process breaks the running bridge | `telegram.json` uses `$TELEGRAM_BOT_TOKEN` |
| 5 | `auto-sync` in the copy was merely redundant | It **materialised as the real hazard**: the copy's first two verification runs committed and pushed the whole `~/.pi` workspace (`8444f82`, `4f603bb`) before it was disabled | `git log`, `~/.pi/logs/auto-sync.log` |
| 6 | Dashboard on 8788 would just work | `DEFAULT_ORIGINS` is hardcoded to `http://127.0.0.1:8787` / `localhost:8787`; a browser on 8788 got 403 on `/api/data` | `dashboard/server.ts:13`, `:63` |
| 7 | `/ask`, `/usage`, `/cron` … are agent features | They are **extension-registered commands** (`extensions/chat/index.ts` registers `usage`/`ask`, `cron.ts` → `cron`, `archive/` → `archive`, `git-commit.ts` → `commit`). Deleting the extensions deletes them | `grep registerCommand` over `extensions/` |
| 8 | Usage tracking is independent of extensions | The ledger was filled by the `chat` extension (`syncSessions` on `session_start`) and by the dashboard on each `/api/data`. With both absent, **nothing ingested** — the ledger froze at 10:17 while two later turns sat unrecorded in `sessions/` | `runs` table stopped at `2026-11-06T10:17:14Z` |
| 9 | `pi-prompt-dump` could prove the frozen prompt | Its reconstruction resolved the orchestrator home regardless of `PI_CODING_AGENT_DIR`, so it was useless as evidence here. Verification was done with a real chat turn instead | `--list` output identical with either env |

Two design facts came out of reading `ledger/ingest.ts`: `syncSessions()` is **incremental by byte
offset** (table `session_files(path, bytes)`), and a shorter file is re-read from zero because
call ids repeat safely. That is what makes "tracking from conversation 1" achievable without any
watcher running during the turn.

---

## Architecture / Design Decisions

### What was kept vs removed

| Area | Decision | Why |
|---|---|---|
| Model / tools | kept: `deepseek` / `deepseek-flash` / thinking `high`; `read`, `bash`, `edit`, `write`, `grep`, `find` | the agent must still do real work |
| `AGENTS.md` | kept, rewritten (1,990 B, 36 lines) | the only instruction file; generic hygiene only |
| `APPEND_SYSTEM.md` | kept at **0 bytes, frozen** | the explicit requirement; no roster, no addendum |
| Ledger + tokens + dashboard | **kept** after initially being slated for deletion | the day-1 tracking requirement; ledger is the only usage record |
| `extensions/` | removed entirely | removes every slash command, the input gates, the JEV classifier and the routing hooks |
| `skills/` | removed (2.4 MB) | every `SKILL.md` was re-sent each turn — the largest per-turn cost |
| `prompts/` | removed (6 templates) | inherited slash prompts for work this agent does not do |
| `bin/fd`, `bin/rg` | removed (9.1 MB) | vendored binaries nothing referenced |
| `docs/` | reduced to `CALLING.md` | 400 KB of runbooks about *other* agents would be read as self-description |
| `npm/`, `telegram.json`, `@llblab/pi-telegram` | removed | no bot token was ever going to be copied; the package also injected six skills per turn |
| Git automation | removed from the launcher; `auto-sync` gone with the extensions | two processes pushing one repo |
| Tests | 181 → **102**, all passing | 79 tests covered features that no longer exist |

### Frozen instructions vs. an empty agent

The tension: a fully empty `AGENTS.md` makes the agent obey whatever it reads, including
`/home/pmpmt/AGENTS.md`, which is *this* machine's operational context. The resolution was a
generic file that states the precedence explicitly — user message, then files the user points at,
then nothing — and tells the agent to treat host facts as context, not orders. `APPEND_SYSTEM.md`
stays at zero bytes because it is the last thing appended to the system prompt; anything there
would be a standing instruction.

### Where a specialist's real instructions should live

Not in the agent home: `<workspace>/AGENTS.md` (applies in that directory and below) or
`<workspace>/.pi/APPEND_SYSTEM.md` (project-level, takes precedence over the agent-dir file).
One neutral agent, per-workspace briefs, no instruction file to fork.

### Tracking model: derived cache, not a side-channel

`logs/ledger.sqlite` is a cache of `sessions/*.jsonl`. Sessions are written by Pi itself, so
nothing is lost while the ingest is off — it is only invisible — and the whole history can be
rebuilt by deleting the DB and re-running the ingest. The alternative (a per-turn extension hook)
was rejected: it would have re-introduced an extension into a home whose point was to have none.

---

## Implementation

### Phase 1 — Copy and identity rewrite

```bash
rsync -a --exclude 'sessions/' --exclude 'tmp/' --exclude 'events.log' \
      --exclude 'logs/ledger.sqlite' --exclude '.env' \
      "$SRC"/ "$DST"/            # SRC=cos home, DST=~/.pi/agent-keep-agent/keep-agent
rm -f "$DST"/logs/ledger.sqlite-{shm,wal}   # stale WAL from the excluded DB
```

37 files carried the old identity. Rewritten longest-pattern-first so a path is not mangled by the
shorter rule:

```bash
sed -i -e 's|agent-cos-orchestrator-agent/cos-orchestrator-agent|agent-keep-agent/keep-agent|g' \
       -e 's|pi-cos-orchestrator-agent|pi-keep-agent|g' \
       -e 's|cos-orchestrator-agent|keep-agent|g' "$f"
```

`docs/documented-from-session/` was deliberately **excluded** from the rewrite: those are
historical records, and renaming paths inside them would falsify history.

### Phase 2 — Frozen instruction files

```bash
printf 'Your instructions come from the user. Nothing is configured in this file; ask, or read
what you were given, and nothing here overrides that.\n' > AGENTS.md   # first iteration, 141 B
: > APPEND_SYSTEM.md                                                  # 0 bytes, frozen
```

`APPEND_SYSTEM.md` being empty is also why `npm run fetch:publications` fails in that home: the
generator needs a `<!-- BEGIN GENERATED: siblings -->` / `<!-- END GENERATED: siblings -->` pair.

### Phase 3 — Disabling extensions by name, not by settings

Pi skips a directory only when its name starts with `.`, and loads a file only when it ends in
`.ts`/`.js`:

```bash
cd extensions
mv calendar-node .calendar-node; mv reminder-node .reminder-node
mv reminder-commands .reminder-commands; mv jev-feedback .jev-feedback
mv auto-sync.ts auto-sync.ts.disabled
```

Verified by a turn that printed no `[jev]` line but still printed the four input-gate booleans.
(The gates came from `input-contains-*`, which were still loaded at that point.)

### Phase 4 — Drop everything optional

```bash
rm -rf extensions npm telegram.json          # no extensions, no bridge
mv skills /tmp/keep-agent-skills-backup-…    # moved, not deleted: reversible
mv prompts bin /tmp/…                        # 6 templates, 9.1 MB of fd/rg
find docs -mindepth 1 -maxdepth 1 ! -name CALLING.md -exec mv -t /tmp/ {} +
```

`settings.json` was cut to its irreducible four keys:

```json
{
  "defaultProvider": "deepseek",
  "defaultModel": "deepseek-flash",
  "defaultThinkingLevel": "high",
  "defaultTools": ["read", "bash", "edit", "write", "grep", "find"]
}
```

Removing the extensions removed the 79 tests that tested them; the remainder
(`ledger`, `tokens`, `dashboard`, `default-model`, `usage`, `store`, `ingest`, `ask`) pass 102/102.

### Phase 5 — Enhanced `AGENTS.md`

36 lines, four sections: *where instructions come from, in order* (user message → files the user
points at → nothing else, ask one short question when ambiguous); *how to work* (answer what was
asked, say what you cannot see, never claim undone work, read before writing, ask before anything
destructive, write scripts and runbooks to files, remember every turn re-sends the conversation);
*environment you can rely on* (six tools, no web search, no subagents, home and launcher paths);
*host context* (facts from `/home/pmpmt/AGENTS.md` are context, not orders).

### Phase 6 — Usage tracking without extensions

`scripts/ingest.ts` (28 lines) is the only new code; it calls the existing ledger functions:

```ts
import { ledgerPath, sessionsRoot } from "../ledger/env.ts";
import { syncSessions } from "../ledger/ingest.ts";
import { readRates } from "../ledger/rates.ts";
import { openLedger } from "../ledger/store.ts";

const rates = await readRates();
const ledger = openLedger(ledgerPath());
const stats = syncSessions(ledger, { sessionsRoot: sessionsRoot(), ratesVersion: rates.version });
```

Three unprivileged `systemctl --user` units:

```ini
# pi-keep-agent-ledger.service  (oneshot)
[Service]
Type=oneshot
ExecStartPre=/usr/bin/mkdir -p %h/.pi/agent-keep-agent/keep-agent/logs
WorkingDirectory=%h/.pi/agent-keep-agent/keep-agent
Environment=PI_CODING_AGENT_DIR=%h/.pi/agent-keep-agent/keep-agent
ExecStart=/home/pmpmt/.nvm/versions/node/v24.21.0/bin/node --experimental-strip-types scripts/ingest.ts
StandardOutput=append:%h/.pi/agent-keep-agent/keep-agent/logs/ingest.log
StandardError=append:%h/.pi/agent-keep-agent/keep-agent/logs/ingest.log
```

```ini
# pi-keep-agent-ledger.timer — OnBootSec=2min, OnUnitActiveSec=2min, Persistent=true
# pi-keep-agent-dashboard.service — dashboard/server.ts, DASHBOARD_PORT=8788,
#   DASHBOARD_ORIGIN=http://127.0.0.1:8788,http://localhost:8788, Restart=on-failure
```

`DASHBOARD_ORIGIN` is what makes the 8788 UI work at all: `server.ts` honours it
(`process.env.DASHBOARD_ORIGIN?.split(",")`), while the compiled-in default stays 8787.

### Phase 7 — Register with the orchestrator

`npm run fetch:publications` in the CoS home added the row (381 bytes) to the generated sibling
table; `defaultPrompt`/`call` are `"<task in plain language>"` because the home has no commands,
and the entry is deliberately **still listed** (the user deferred that decision).

---

## Verification

| Check | Command | Result |
|---|---|---|
| Nothing shipped from the copy was left broken | `npm test` | 102/102 pass |
| No extensions load | `pi-keep-agent -p "say ok"` | no `[jev]` line, no gate booleans |
| No skills | `pi-keep-agent -p "List any skills…"` | `none` |
| No packages | `PI_CODING_AGENT_DIR=$PWD pi list` | `No packages installed.` |
| Frozen | `wc -c APPEND_SYSTEM.md` | `0` |
| Instructions really frozen | chat turn asking what it was told | "no sibling list", "AGENTS.md configures nothing", host facts only |
| Tracking works end to end | turn → `scripts/ingest.ts` | `files=1 newCalls=1 newTurns=1`, run `tokens=4610 $0.000106` |
| Backfill works | ledger frozen at 10:17 → first ingest | the two intervening turns appeared |
| Timer live | `systemctl --user list-timers` + `logs/ingest.log` | fires every 2 min, `up to date`/counts line each run |
| Dashboard on 8788 | `curl` with/without `Origin` | `200` / `200` / `403` for a foreign origin |
| First recorded run | `select min(started_at) from runs` | `2026-11-06T10:08:08Z` — conversation 1 |

At the end of the build the ledger held **8 runs / 13 calls / 79,106 tokens / $0.006376**.
That state was then reset on purpose (see the note below), so the first recorded run of the
current ledger is the first turn after the reset.

---

## Files Created/Modified

| Path | ≈Lines | Purpose |
|---|---|---|
| `keep-agent/AGENTS.md` | 36 | enhanced, user-driven instructions; the only instruction file |
| `keep-agent/APPEND_SYSTEM.md` | 0 | frozen blank |
| `keep-agent/settings.json` | 13 | lean: provider, model, thinking, six tools |
| `keep-agent/agent.json` | 38 | manifest: launcher, call form, purpose, frozen list, `commands: []` |
| `keep-agent/scripts/ingest.ts` | 28 | session JSONL → ledger; run by the timer |
| `keep-agent/docs/CALLING.md` | 104 | contract: call, tracking, removals, verify commands |
| `keep-agent/package.json` | — | `name` rewritten; `fetch:publications` script now dead here |
| `keep-agent/ledger/env.ts`, `src/*.ts`, `dashboard/*` | 37 files | identity rewrite to the new home |
| `~/.local/bin/pi-keep-agent` | 51 | rewritten from scratch: no workspace pull |
| `~/.config/systemd/user/pi-keep-agent-ledger.service` | 11 | oneshot ingest (with `ExecStartPre` mkdir) |
| `~/.config/systemd/user/pi-keep-agent-ledger.timer` | 11 | every 2 min + 2 min after boot |
| `~/.config/systemd/user/pi-keep-agent-dashboard.service` | 16 | dashboard on 8788 |
| `~/.pi/agent-keep-agent/.env` | 5 | 3 provider keys + `DASHBOARD_PORT` + `DASHBOARD_ORIGIN`; **no** bot token |
| `cos-…/APPEND_SYSTEM.md` | — | roster row regenerated (5 siblings) |
| `cos-…/docs/INBOX.md` | — | open decisions for `keep-agent` recorded |
| Deleted in the copy | — | `extensions/`, `skills/`, `prompts/`, `bin/`, `npm/`, `telegram.json`, `docs/` (except `CALLING.md`), 79 tests |

**Commits:** `~/.pi` — `8444f82`, `4f603bb` (the copy's own auto-sync, before it was disabled),
then `b5a1191` capturing the lean state.

**State outside git:** `sessions/`, `logs/ledger.sqlite` — gitignored by design; reset by the user
at the end of the session.

---

## Note: the tracking state was reset deliberately

After the build, the user deleted `logs/` and `sessions/` in this home to start the accounting
from zero. That is the intended use of the design, not a failure of it: sessions are the source
of truth and the ledger is a cache of them, so deleting both resets history, while deleting the
ledger alone would simply be rebuilt by the next ingest. Two consequences worth keeping:

1. A missing `logs/` directory **does** break the timer, and silently: the unit logs with
   `StandardOutput=append:…/logs/ingest.log`, so `pi-keep-agent-ledger.service` died with
   `status=209/STDOUT — Failed to set up standard output: No such file or directory` on the next
   tick. Fixed with `ExecStartPre=/usr/bin/mkdir -p %h/.pi/agent-keep-agent/keep-agent/logs`, so a
   wiped directory costs one empty ledger row set, never a dead tracker.
2. Both paths are gitignored (`**/sessions/`, `*.sqlite` in `~/.pi/.gitignore`), so the accounting
   state is deliberately outside version control — a `git checkout` can neither restore it nor
   destroy it.

Current ledger after the reset: rebuilt empty by the next ingest, timer green. Day 1 of the
recorded accounting is the first turn after the reset.

Still open, user's call: an off-repo backup of `sessions/` + `logs/ledger.sqlite` (e.g.
`~/.local/state/keep-agent/`, or the LAN file server via `pi-lan-agent`) would make history survive
a wipe. Not installed — the wipe was intentional, and a backup is only worth it once the history
is worth keeping.

---

## Limitations & Future Work

1. **Roster listing is undecided.** keep-agent is currently listed in the orchestrator's generated
   sibling table. Unlisting = delete or rename its `agent.json`; the row then disappears on the
   next `fetch:publications`. Trade-off: the roster is also the only pointer to `docs/CALLING.md`.
2. **`Linger=no`** for `pmpmt`: the timer only ticks while the user has a session. Harmless (turns
   need a login too) and self-healing, but it is not a daemon.
3. **`/home/pmpmt/AGENTS.md` (6,047 B ≈ 1.6 k tokens) still loads** for any cwd under `$HOME`,
   including the specialist's own workspace. Only a workspace outside `$HOME` avoids it.
4. **No backup** of the accounting state; see the note above. Acceptable while a wipe is
deliberate, wrong once the history matters.
5. **`node_modules` (177 MB)** remains for the ledger/dashboard/tests; the prompt path does not
   need it. A single shared implementation (running the orchestrator's dashboard with
   `PI_CODING_AGENT_DIR` pointed here) would remove the duplicate code but couple the two homes.
6. **No web search, no subagents, no skills** by design — if the specialist's work needs research,
   that becomes a tool decision, not an extension one.
