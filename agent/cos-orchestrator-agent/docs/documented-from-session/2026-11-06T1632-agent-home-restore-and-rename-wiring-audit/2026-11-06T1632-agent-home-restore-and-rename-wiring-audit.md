# Agent Home Restore & Rename Wiring Audit — Debug & Recovery Report

**Date:** 2026-11-06
**System:** Ubuntu 24.04.5 LTS, Pi v1.5.0 (upgraded from v1.4.0 the same day), Node v24.21.0
**Location:** wrapper `~/.pi/agent/` (repo root: `.env`, `README.md`, `.gitignore`) → agent home
`~/.pi/agent/cos-orchestrator-agent/`; repo `~/.pi`; archive `~/.pi/z.old/.pi/agent/`; VPS
`neopmpmtj` at `/home/pmpmt/.pi/agent/cos-orchestrator-agent/`

---

## Problem

The COS home was renamed in git on 2026-11-06 (`agent-cos-orchestrator-agent/` → `agent/`, commit
`8755ed5`, 137 renames). The follow-up request was a wiring audit of that rename. What the audit
actually found was that, 25 minutes after the rename, the **live agent home had been archived
away** by `/archive '/home/pmpmt/.pi/agent'` and the deletion had been committed and **pushed to
GitHub**.

State at the start of the session:

| Item | Observed |
|---|---|
| `AGENTS.md`, `APPEND_SYSTEM.md`, `agent.json` | absent from the home |
| `extensions/`, `ledger/`, `docs/`, `dashboard/` | present as directories, **0 files** |
| `node_modules` | 6,563 files instead of ~8,700 (file moves had gutted it) |
| `logs/ledger.sqlite` | gone (usage history) |
| `settings.json` | listed 13 extensions, all missing on disk |
| `origin/main` | `19545d0` — the commit that deleted 70 files / 10,505 lines |
| VPS replica | running the **pre-rename** path, 4 commits behind |

The VPS risk was the urgent part: its launcher runs `git -C ~/.pi pull --ff-only` on every start,
so the next restart would have applied the rename *and* the deletion, emptying the VPS home.

### Timeline of the incident

| Time (WET) | Event |
|---|---|
| 15:30 | pi upgraded to 1.5.0 (global package mtime) |
| 15:48 | session starts: "top folder was agent-cos-orchestrator, now it is simply agent" |
| 15:53:19 | `8755ed5` — the rename: 137 renames, 4 real edits |
| 15:53:35 | new session, single command: `/archive '/home/pmpmt/.pi/agent'` |
| 15:53:47 | archive run id `2026-11-06T15-53-47-869` moves 8,765 paths into `~/.pi/z.old/` |
| 15:56 | the still-running pi is shut down; its in-memory `auto-sync.ts` commits the deletions |
| 15:56:09 | second archive run (`…T15-56-09-796`) moves `~/.pi/##agent/` out |
| 16:06:43 | `19545d0` "session work" — 70 files, 10,505 deletions, 0 insertions, pushed |
| 16:08:55 | this session starts in the gutted home |

---

## Investigation / Root Cause

### 1. The archive target was the live home, not an old folder

The `/archive` implementation is `src/archive-command.ts` → `apps-scripts/archive-to-target-full-tree/…/archive_to_target_full_tree.py`.
It does a *full-tree* move of the given `<path>` into the configured target (`~/.pi/z.old/`),
renaming each file with the run id as a prefix. The command was given `~/.pi/agent` — the new
wrapper directory created by the rename — so it moved:

- the wrapper files (`README.md`, `.gitignore`, `.env.example`, `.env`),
- the entire agent home (instructions, extensions, ledger, docs, dashboard, `node_modules`),
- and left empty directory skeletons plus whatever was untracked-and-ignored (`sessions/`,
  `tmp/`, `state/`... none of which existed at the wrapper root).

Evidence recovered from the archived run's own transcript
(`sessions/--home-pmpmt-.pi-agent-cos-orchestrator-agent--/2026-11-06T15-53-35-651Z_…jsonl`, 5 lines):
the only user message is `/archive '/home/pmpmt/.pi/agent'`, followed by one `custom_message` whose
log ends with 8,765 `[ok]` lines and one `[FAIL] [ok]` on `.env`.

### 2. Why the deletion reached GitHub

`extensions/auto-sync.ts` commits and pushes on `session_shutdown`, with the message
`` `[pi:${hostname()}] ${context}` `` where `context` is the last assistant text. The archive had
moved `auto-sync.ts` off disk, but the extension was already **loaded in memory**: when the pi
process ended at ~15:56 it staged the now-missing files, committed with the truncated assistant
line ("Looked at the whole move. Short version: **the runtime on th…"), and pushed.

This was later confirmed observationally: after the VPS migration, its own `auto-sync` produced
`[pi:neopmpmtj] session work` and pushed a stray file without being asked.

### 3. The rename itself was clean

Checked and found consistent, so nothing was changed here:

| Check | Result |
|---|---|
| rename commit shape | 137 renames, `R086`–`R100`; 4 real edits (`README`, `AGENTS`, `APPEND_SYSTEM`, `agent.json`, `trust.json`) |
| `~/.local/bin/pi` | `PI_CODING_AGENT_DIR="$HOME/.pi/agent/cos-orchestrator-agent"`, `ENV_FILE="$HOME/.pi/agent/.env"` — matches |
| `xtra/bash-system-scripts/start-dashboards.sh` | `orch="$root/agent/cos-orchestrator-agent"` — matches |
| stale `agent-cos-orchestrator-agent` references in code, config, scripts, docs | 0 (only historical `docs/documented-from-session/*` and `z.old/`, left as records) |
| `cron.ts` engine hop (`../../../cron`) | correct for both layouts |

### 4. Six gitlinks with no `.gitmodules`

`git submodule status` failed with `fatal: no submodule mapping found in .gitmodules for path
'…/skills/agent-replica-adapt'`. Five skill dirs and `jev-classifier/` were recorded as mode
`160000` commits because they are nested git repos that were `git add`ed at some point. Consequence,
reproduced in a throwaway clone: **checkout materialises empty directories, silently** — a fresh
clone (and the VPS) had 0 of 7 skills and no `jev-classifier`.

Pinned commits were verified reachable on their remotes before wiring them up:

| Submodule | Pinned | Remote |
|---|---|---|
| `agent-replica-adapt` | `32c90f0` | `skill-agent-replica-adapt` |
| `pi-prompt-dump` | `0fe414a` | `skill-pi-prompt-dump` |
| `skill-creator` | `c82d05e` | `skill-skill-creator` |
| `video-finder` | `d4f4f39` | `skill-video-finder` |
| `yt-download` | `6077ac4` | `skill-yt-download` |
| `jev-classifier` | `6b43d6d` | `jev-classifier` |

`agent-creator/` and `svg-photo-convert/` are plain tracked trees — correctly so.

### 5. The cron store silently relocated (nesting side effect)

`~/.pi/cron/store.ts` computed its store as:

```ts
const CRON_DIR = path.join(
  process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME || "/tmp", ".pi/agent"),
  "..",            // "go up from agent to .pi"
  "cron"
);
```

That arithmetic only holds while the agent home is **exactly one level below `~/.pi`**. It was true
when the home was `~/.pi/agent` (store → `~/.pi/cron`). After the rename the home is
`~/.pi/agent/cos-orchestrator-agent`, so `..` lands on `~/.pi/agent` and the store became
`~/.pi/agent/cron/jobs.json` — an empty store created at 11:37 the same day. The two real jobs in
`~/.pi/cron/jobs.json` stopped being read:

| Job | State found | Meaning |
|---|---|---|
| Daily Laptop Backup | `nextRunAtMs` = 2026-11-03T08:20Z, last run 2026-11-02 | not scheduled for 3 days |
| gog-token-keepalive | `nextRunAtMs` = 2026-11-03T08:00Z | not scheduled for 3 days |

`~/.pi/.gitignore` already lists `cron/jobs.json` and `cron/runs/` at the engine path — independent
confirmation that `~/.pi/cron` is the intended location.

### 6. pi 1.5.0 vs devDependencies 1.4.0

The global pi was upgraded to 1.5.0 at 15:30; the home still pinned `@earendil-works/pi-ai` and
`pi-coding-agent` at `1.4.0`, so `npm run typecheck` was validating an API the runtime did not have.
`tsc --noEmit` reported 15 errors, all in `extensions/cron.ts`:

| Code | Count | Real cause |
|---|---|---|
| `TS2835` | 4 | `../../../cron/*` imported without `.ts` (repo convention is explicit extensions) |
| `TS7006` | 7 | fallouts of the unresolved `cron/types.ts` import (`j`, `r` implicitly `any`) |
| `TS2322` | 3 | `let scheduleInput = ""` assigned from `ctx.ui.input(): string \| undefined` |
| `TS2769` | 1 | `pi.on("session_end", …)` — not a valid hook |

Reading the installed 1.5.0 typings showed the hook set (`session_start`, `session_shutdown`,
`session_before_*`, `agent_end`, `before_agent_start`, `input`, `tool_call`, `tool_result`, …) and
that `on()` merely stores handlers in a map keyed by event name — so `session_end` was a **silent
no-op**, not a crash: the cron timer was never cleared on shutdown.

Bumping the devDeps to 1.5.0 exposed one more break: `import { Type } from "@earendil-works/pi-ai"`
no longer exists (schema helpers moved). pi's own `docs/extensions.md` prescribes
`import { Type } from "typebox"` (typebox 1.3.27 is already a `pi-coding-agent` dependency).

### 7. VPS replica drift

| Item | Laptop | VPS (found) |
|---|---|---|
| repo HEAD | `19545d0` → later `699e80c` | `1c194ed` (4 commits behind) |
| pi version | 1.5.0 | **1.4.0** |
| active unit | (not systemd-managed) | `pi-cos.service` → `pi-cos-supervisor.sh` → tmux `-L pi-cos` |
| documented unit in `~/AGENTS.md` | — | claimed `pi-agent.service` (actually **disabled/inactive**) |
| launcher | `~/.local/bin/pi` | `~/.local/bin/pi-cos-orchestrator-agent` (old wrapper, no model block) |
| `PI_CODING_AGENT_DIR` | `~/.pi/agent/cos-orchestrator-agent` | `~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent` |
| skills | 7/7 | **1/7** (`yt-download` only) |
| `node_modules` in home | 15,238 files | **absent** → extensions importing `pi-ai`/`typebox` could not resolve |
| git auth | https via credential helper | **SSH** (`git@github.com:…`), so the https `.gitmodules` URLs could not clone |

### 8. Instruction and config contradictions

- `APPEND_SYSTEM.md` told the agent: *"Tools: read, bash, edit, write, grep, and find. **No web
  search, skills, subagents, or cron.**"* — while `settings.json` loads 13 extensions (including
  `/cron` and a `cron` tool) and `skills/` holds seven skills.
- `settings.json` listed `+extensions/pi-prompt-capture.ts` while the file on disk has been
  `pi-prompt-capture.ts.disabled` since 2026-11-05 — a failing load on every start.
- `agent/cron/jobs.json` existed as a tracked, empty store while the engine read `~/.pi/cron`.

---

## Architecture / Design Decisions

### Restore source: git or the archive?

| | git (`8755ed5`) | `z.old` archive |
|---|---|---|
| Tracked content | exact by definition | exact, but renamed with a run-id prefix |
| Untracked runtime (`ledger.sqlite`, `events.log`, `node_modules`) | absent — gitignored | present |
| Auditability | commit hash | needs a byte comparison to trust |

**Decision: both, with the archive as the checksum.** Restore tracked files with
`git checkout 8755ed5 -- …`, then compare every archived file against `git show 8755ed5:<path>`.
Result: **63 of 63 identical, 0 differ**, so the archive held nothing unique except runtime state
(`logs/ledger.sqlite*`, `events.log`, `node_modules`, `auth.json`, `models-store.json`, `bin/`).

### Dead gitlinks: submodules, or untrack and ignore?

| Option | Fresh clone | VPS | Effort |
|---|---|---|---|
| Add `.gitmodules` | `git submodule update --init` populates | needs the same | one file |
| `git rm --cached` + ignore | clones get **nothing** | VPS loses skills | rewrites index |
| De-nest the repos into the parent | content in one repo | works | loses each skill's own history/remote |

**Decision: real submodules.** All pinned commits exist upstream, so the gitlinks were already
valid, just unmapped. `.gitmodules` keeps https URLs (portable) and the VPS additionally gets
`url."git@github.com:".insteadOf https://github.com/` since it authenticates by SSH.

### Cron store: where should it live?

| Option | Survives a home move | Survives bundling | Notes |
|---|---|---|---|
| `join(PI_CODING_AGENT_DIR, "..", "cron")` | no — this regression | no | assumes home is 1 level under `~/.pi` |
| env override `PI_CRON_DIR` | yes | yes | another variable to set on every host/launcher |
| `dirname(fileURLToPath(import.meta.url))` | yes | relocates with the engine | the engine *is* `~/.pi/cron` |

**Decision: module-relative.** The store sits beside the code that owns it; the launcher and env
need no cooperation, and `~/.pi/.gitignore` already assumes that path.

### VPS secrets: share the wrapper `.env` or keep a home-local one?

The VPS's `~/.pi/agent/.env` is **not** the COS env — it is the legacy default home's file, sourced
by other services (gog, backups, postgres). Key comparison by hash:

| Key | wrapper `.env` (COS) | `~/.pi/agent/.env` (legacy) |
|---|---|---|
| `DEEPSEEK_API_KEY` | `0c1c…` | same |
| `OPENAI_API_KEY` | `60d8…` | same |
| `GEMINI_API_KEY` | `01c8…` (`AIza…`, working) | **different** — `AQ.Ab8…`, the key `docs/INBOX.md` already records as dead (401, bound service account deleted) |
| `TELEGRAM_BOT_TOKEN` | `fa01…` | present but **empty** — stripped on 2026-11-06 to leave `pi-cos.service` the only poller |

**Decision: home-local `.env` on the VPS** (`<agent home>/.env`), documented as a deliberate
deviation. The two files belong to different identities: merging the working `AIza…` Gemini key
into `~/.pi/agent/.env` would silently rewrite a file other services own, and merging the other
way would hand the COS agent the dead key. The empty bot token stays empty on purpose — that file
is not the bridge's config. The laptop keeps the documented layout (`~/.pi/agent/.env`).

### VPS migration order

`git pull` applies the rename, which **deletes tracked files from the old path**. So the order is:
stop the unit → back up the whole home → pull → restore ignored/untracked state with
`rsync --ignore-existing` (tracked files win) → submodules → `npm install` → move the launcher/env →
archive the leftovers → start → verify. `--ignore-existing` is what makes sessions, `npm/`,
`logs/`, `state/` land without overwriting the freshly pulled tracked files.

`##agent/` was deliberately **not** restored: it was moved out by its own archive run at 15:56 and
nothing references it. It stays in `z.old/` and stays deleted in git.

---

## Implementation

### Phase 0 — Establish ground truth

```bash
git -C ~/.pi show --stat 19545d0           # 70 files, 10,505 deletions, 0 insertions
git -C ~/.pi show --name-status -M 8755ed5 # 137 renames = the actual "move"
ls -la ~/.pi/z.old/.pi/agent/              # 2026-11-06T15-53-47-869_* prefixes
```

### Phase 1 — Restore the home

```bash
git show --name-status --format='' HEAD | grep -E '^D.*agent/' | sed 's/^D\t//' > /tmp/restore-list.txt
xargs -a /tmp/restore-list.txt -d '\n' git checkout 8755ed5 --   # 70 paths
git rm -r --cached -q '##agent' && rm -rf '##agent'              # leave it archived
```

Then the parts git could not return:

```bash
# run history, 191 runs / 1,831 calls
for f in "$ARCHIVE"/logs/*_ledger.sqlite*; do cp -a "$f" "logs/${f##*_ledger}"; done
cp -a "$ARCHIVE"/2026-11-06T15-53-47-869_events.log events.log
npm install --no-audit --no-fund          # 6,563 → 15,238 files, .bin/ and typescript restored
```

A completeness sweep — every archived file compared against its live path — left exactly:
8,681 `node_modules/*` (fixed above), 2 sqlite `-wal`/`-shm` files (removed by the clean close that
followed), and 3 files from the *2026-11-03* archive run (never part of this one).

### Phase 2 — Make the clone path work

```ini
# ~/.pi/.gitmodules (new)
[submodule "agent/cos-orchestrator-agent/skills/video-finder"]
	path = agent/cos-orchestrator-agent/skills/video-finder
	url = https://github.com/neopmpmtj/skill-video-finder.git
… five more, including jev-classifier …
```

`.gitignore`: the `agent/skills/*` block named paths that no longer exist (and are now submodules);
replaced with a pointer to `.gitmodules`.

### Phase 3 — Fix the extension/config drift

```bash
# settings.json — the file on disk is pi-prompt-capture.ts.disabled
-    "+extensions/pi-prompt-capture.ts",
# package.json — match the runtime
-    "@earendil-works/pi-ai": "1.4.0",
-    "@earendil-works/pi-coding-agent": "1.4.0",
+    "@earendil-works/pi-ai": "^1.5.0",
+    "@earendil-works/pi-coding-agent": "^1.5.0",
+    "typebox": "^1.3.27",
# ~/.pi/cron/package.json (new) — the engine is imported as ESM
{ "name": "pi-cron-engine", "private": true, "type": "module", … }
```

`extensions/cron.ts`, six targeted edits:

```diff
-import { Type } from "@earendil-works/pi-ai";
+import { Type } from "typebox";
-import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
+import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
-import { normalizeCronJobCreate, … } from "../../../cron/normalize";
+import { normalizeCronJobCreate, … } from "../../../cron/normalize.ts";   # and schedule/store/types
-    async execute(_toolCallId, params) {
+    async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {   # heterogeneous details
-          let scheduleInput = "";
+          let scheduleInput: string | undefined = "";
-  pi.on("session_end", async () => {
+  pi.on("session_shutdown", async () => {
```

`APPEND_SYSTEM.md` now describes the real surface instead of "no web search, skills, subagents, or
cron":

```markdown
- Tools: `read`, `bash`, `edit`, `write`, `grep`, and `find`, plus the extensions in `settings.json`:
  `/cron` (with a `cron` tool), `/ask`, `/usage`, `/archive`, `/sync`, the calendar and reminder
  routers with `/reminders`, `/reminder-done`, `/reminder-undo` and `/calendar-undo`, `/jev-wrong`,
  input tagging, and secret scrubbing. Skills live in `skills/`… There is no web search and no
  subagent tool: delegate to a sibling instead.
```

### Phase 4 — Fix the cron store path

```diff
-import type { CronJob, CronStoreFile, CronRunEntry } from "./types.ts";
-
-const CRON_DIR = path.join(
-  process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME || "/tmp", ".pi/agent"),
-  "..", // go up from agent to .pi
-  "cron"
-);
+import { fileURLToPath } from "node:url";
+import type { CronJob, CronStoreFile, CronRunEntry } from "./types.ts";
+
+const CRON_DIR = path.dirname(fileURLToPath(import.meta.url));
```

Same change applied to the `.ts`-suffixed imports in `cron/normalize.ts`, `cron/schedule.ts`,
`cron/store.ts`. Verified in-process: `STORE_PATH = /home/pmpmt/.pi/cron/jobs.json`,
`jobs loaded: 2 — Daily Laptop Backup | gog-token-keepalive`.

### Phase 5 — Migrate the VPS

```bash
# on neopmpmtj
cp -a ~/.pi/agent-cos-orchestrator-agent ~/pi-cos-migration-<ts>/old-wrapper-dir   # 18 MB backup
systemctl --user stop pi-cos.service
git -C ~/.pi pull --ff-only                     # 1c194ed → current, applies the rename
git -C ~/.pi submodule update --init --recursive
cd ~/.pi/agent/cos-orchestrator-agent && npm install --no-audit --no-fund    # 80 packages
for item in auth.json events.log models-store.json telegram.json sessions logs state npm bin tmp; do
  rsync -a --ignore-existing ~/pi-cos-migration-<ts>/old-wrapper-dir/cos-orchestrator-agent/$item ./
done
install -m 0600 <old .env> ./env                # COS secrets stay home-local on this host
install -m 0755 ./pi-cos-vps ~/.local/bin/pi-cos-orchestrator-agent
npm install -g @earendil-works/pi-coding-agent@1.5.0   # parity: 1.4.0 → 1.5.0
systemctl --user start pi-cos.service
```

Launcher delta from the laptop's `~/.local/bin/pi` (72 lines, otherwise identical):

```diff
+export PI_CODING_AGENT_DIR="$HOME/.pi/agent/cos-orchestrator-agent"
+
 set -a
-ENV_FILE="$HOME/.pi/agent/.env"
+ENV_FILE="$PI_CODING_AGENT_DIR/.env"
 [ -f "$ENV_FILE" ] && source "$ENV_FILE"
 set +a
-
-export PI_CODING_AGENT_DIR="$HOME/.pi/agent/cos-orchestrator-agent"
```

Leftovers moved to the backup dir, not deleted: old wrapper dir, legacy `~/.pi/agent/skills/`,
`agent/.env.bak-20261106-1309`. Final `git status` on the VPS: 0 lines.

### Phase 6 — Correct the host facts

`~/AGENTS.md` on both machines was updated: pi 1.4.0 → 1.5.0; VPS autostart is `pi-cos.service`
(`pi-agent.service` is legacy/disabled); submodule + `insteadOf` requirements; the VPS's home-local
`.env`; the shared bot token warning. The laptop `~/AGENTS.md` had been documenting the *wrong unit*
as the VPS's autostart.

---

## Verification

| Check | Command | Result |
|---|---|---|
| Nothing unique was lost to the archive | per-file `cmp` vs `git show 8755ed5:` | 63/63 identical, 0 differ |
| Completeness of the restore | archived-vs-live sweep | only `node_modules` + 2 sqlite sidecars + 3 foreign files |
| Usage history intact | `select count(*) from runs/calls` | 191 runs, 1,831 calls |
| Typecheck matches the runtime | `npm run typecheck` (v1.5.0 types) | **0 errors** (was 15, then 16 after the bump, then 5 in `~/.pi/cron`) |
| Behaviour preserved | `npm test` | **181/181** (was 169/170 with `ask.test.ts` failing on missing `pi-ai`) |
| Extensions all resolve | compare `settings.json` list to disk | 13/13 |
| Fresh clone gets a whole agent | `git clone` + `submodule update --init` | 7/7 skills + `jev-classifier` (before: 5 empty + 1 empty) |
| Cron store points at the real jobs | import `cron/store.ts`, print `STORE_PATH` | `~/.pi/cron/jobs.json`, 2 jobs |
| VPS is on the new layout | `/proc/<pid>/environ`, `ls /proc/<pid>/cwd` | `…/agent/cos-orchestrator-agent` both |
| VPS loads everything | tmux pane `[Context] [Skills] [Prompts] [Extensions]` | `APPEND_SYSTEM.md, AGENTS.md, ~/AGENTS.md`; 11 skills; 15 extensions; **no error lines** |
| VPS bridge owns the bot | `tmp/pi-telegram/logs.jsonl` | `Telegram auto-start completed`, `lockState: active here` |
| VPS pulls on restart | `systemctl --user restart` → `git log` | picked up `699e80c` unaided |
| No stale paths anywhere | grep `agent-cos-orchestrator-agent` (excl. history/archive) | 0 hits |

Not exercised: an interactive **laptop** session loading all 13 extensions under 1.5.0. The same
files load cleanly on the VPS under 1.5.0, and starting a second bridge here would have contested
the shared bot token.

---

## Files Created/Modified

| Path | ≈Lines | Purpose |
|---|---|---|
| `~/.pi/.gitmodules` | 18 | **new** — maps the 5 skills + `jev-classifier` gitlinks to remotes |
| `~/.pi/.gitignore` | −8/+5 | dead `agent/skills/*` block → pointer to `.gitmodules` |
| `~/.pi/cron/store.ts` | 83 (−5/+7) | store dir from the module URL, not `agentDir/..` |
| `~/.pi/cron/package.json` | 6 | **new** — `"type": "module"` so the engine typechecks as ESM |
| `~/.pi/cron/normalize.ts`, `schedule.ts` | −1/+1 each | `.ts` import extensions |
| `~/.pi/agent/.gitignore` | 18 | restored (ignores `.env`, `logs/`, `model-rates.json`, `default-model.json`…) |
| `~/.pi/agent/README.md` | 156 | restored — layout: wrapper root holds `.env` + rate card |
| `~/.pi/agent/.env.example` | 7 | restored |
| `…/cos-orchestrator-agent/AGENTS.md` | 82 | restored (portable rules) |
| `…/APPEND_SYSTEM.md` | 31 | restored, then Tools line corrected to the real extension/skill surface |
| `…/agent.json` | 76 | restored (manifest, commands) |
| `…/settings.json` | 61 | dropped the missing `pi-prompt-capture.ts` entry |
| `…/package.json` | 21 | devDeps 1.4.0 → 1.5.0, added `typebox` |
| `…/extensions/cron.ts` | 783 | restored, then 6 edits (typebox `Type`, `session_shutdown`, `.ts` imports, one widened declaration, result annotation) |
| `…/extensions/` (14 others), `ledger/`, `dashboard/`, `docs/` | 14 / 8 / 4 / 33 files | restored |
| `agent/cron/jobs.json` | −4 | deleted — dead duplicate of the engine store |
| `…/logs/ledger.sqlite` + `-wal/-shm`, `events.log` | 1.85 MB | restored from the archive (gitignored) |
| `~/AGENTS.md` (laptop) | — | pi 1.5.0, real VPS unit, submodules, shared-token warning |
| `/home/pmpmt/AGENTS.md` (VPS) | — | new home path, home-local `.env`, submodule + `insteadOf` notes |
| `~/.local/bin/pi-cos-orchestrator-agent` (VPS) | 75 | rewritten from the laptop launcher; env moved inside the home |
| `~/.pi/agent/cos-orchestrator-agent/.env` (VPS) | 4 | COS secrets, mode 0600, alongside the home |

**Commits:** `18e2ca9` (restore + wiring, 75 files, 10,469 insertions), `699e80c` (cron store).
`f916881` is the VPS agent's own auto-sync commit in between.

---

## Post-Migration State & Open Items

Both machines now run the same home path, the same pi (1.5.0), the same `.gitignore`/submodule
rules, and `git status` is clean on both.

Deliberately **not** changed, needing a decision (also recorded in `docs/INBOX.md`):

1. **Shared Telegram token.** The laptop's `~/.pi/agent/.env` carries the same
   `TELEGRAM_BOT_TOKEN` as the VPS, and `@llblab/pi-telegram` auto-starts. The VPS's legacy
   `~/.pi/agent/.env` has the token stripped by design, so `pi-cos.service` is the single poller
   today — but that is only because the laptop's home was gutted. After the restore, the next
   laptop session loads the package and contends for the same bot (`409` conflicts, dropped
   messages). Options: blank the token on the laptop, or give it a second bot.
2. **Two overdue cron jobs.** They will fire on the next laptop start (backup + `gog` keepalive,
   overdue since 2026-11-03). The backup command's path resolves today (`main.py` present) but its
   last recorded run failed — run them, reschedule, or disable first.
3. **`~/.pi/z.old` is 226 MB** and holds two archive runs, now provably redundant with git plus the
   recovered runtime state. Safe to prune on request.

Known leftovers, harmless: `pi-agent.service` on the VPS remains installed-but-disabled (documented
as legacy); a few `.gitignore` rules still describe the pre-nesting layout (`agent/npm/`,
`agent/git/`, `agent/observability/`, `agent/pi-web-access/`, `agent/tmp/`) and no longer protect
anything; `default-model.json` does not exist, so the launcher's model block is skipped and
`settings.json` supplies the default (`deepseek` / `deepseek-flash`).
