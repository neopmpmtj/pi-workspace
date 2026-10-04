# Observability Token Lineage & VPS Transplant — Setup & Implementation Report

**Date:** 2026-10-04
**System:** Ubuntu 24.04 · Node v24.21.0 (`node:sqlite`) · Pi v1.0.2 (dev laptop) / v1.0.0 (VPS)
**Location:**
- `~/.pi/agent/extensions/observability/index.ts` — the extension (source of truth)
- `~/.pi/agent/observability/` — output sink (`runs.jsonl` + `runs.sqlite`)
- `~/.pi/agent/npm/node_modules/pi-agents-pool/extension/agent-pool.ts` — locally patched package
- `~/.pi/docs/pi-state-summary.md` — living inventory
- VPS `neopmpmtj` (100.85.79.17), user `pmpmt`, target `~/.pi/agent/`

---

## Problem

Three distinct but interlocking problems surfaced in one session.

### 1. Token accounting could not answer the question that mattered

Pi is now an **orchestrator**: it spawns subagents (`subagent`, `spawn_agent`) that execute tasks in isolated `pi` processes. Each child consumes its own tokens. The observations were technically complete — every child's run *was* recorded — but the database was a **flat list of runs with no lineage**. It was impossible to ask:

- "What did this one orchestration cost, including all descendants?"
- "Which agent burns the most tokens?"

Answering either required string-surgery on a `session_file` path. Cost was explicitly deprioritised by the operator ("many undetermined factors and changing all the time") — **token consumption** was the metric that mattered.

### 2. Git was tracking live binary databases

`agent/observability/runs.jsonl` was a tracked 4.2 MB artifact of session data, and `runs.sqlite` + `runs.sqlite-shm` + `runs.sqlite-wal` had been **committed as binaries** — including a 144 KB WAL file. A `git add -A` from any agent would commit an inconsistent, actively-rewriting database.

### 3. The VPS was running an ancestor version

`neopmpmtj` had the original JSONL-only extension (471 lines), with no SQLite sink and no lineage. Its own `runs.jsonl` held 23 runs.

### Goal

Make token consumption attributable per orchestration and per agent, keep binary databases out of git, and deploy the result to the VPS without disturbing existing history.

---

## Investigation

### 1. Is the recorded token data even trustworthy?

Before building anything on top of the numbers, the recorded tokens were reconciled against **pi's own session files** — an independent ground truth, since every assistant message carries a `usage` object.

| run | assistant msgs | turns | DB tokens | session-file tokens | ratio |
|---|---|---|---|---|---|
| `…m4r50g` | 7 | 7 | 189,050 | 189,050 | **1.00×** |
| `…sal80q` | 6 | 6 | 276,984 | 276,984 | **1.00×** |
| `…kjvgdr` | 2 | 2 | 109,875 | 109,875 | **1.00×** |
| `…h4yzbx` | 3 | 3 | 176,108 | 176,108 | **1.00×** |
| `…e7kc1y` | 17 | 17 | 1,316,383 | 1,316,383 | **1.00×** |
| `…xlmn8n` | 5 | 5 | 471,496 | 471,496 | **1.00×** |
| `…pij2ar` | 11 | 11 | 1,202,833 | 1,202,833 | **1.00×** |

Exact on all seven, all fields. A **suspected bug was retracted** as a result: `message_end` *assigns* `currentTurn.tokenUsage` rather than accumulating it, which looked like it would lose tokens on multi-message turns. The data disproved it — `assistant msgs == turns` in every run, so a turn is exactly one assistant message.

### 2. The correct token model

From a real `usage` block: `input 191, output 289, cacheRead 21760, cacheWrite 0, reasoning 170, total 22240`.

`191 + 21760 + 0 + 289 = 22240` ✓ — therefore:

| metric | formula | meaning |
|---|---|---|
| **prompt / context** | `input + cacheRead + cacheWrite` | what is re-sent on every call |
| **completion** | `output` | actual generation |
| `reasoning` | **subset of `output`** — never additive | `170 ≤ 289`; if additive the identity breaks |

**Two traps this exposes:**

1. `reasoning` must never be added to a total — it is already inside `output`. Doing so inflates every figure by ~30%.
2. `total` is **~98% cache reads**. On the orchestrator session: 97.32% cacheRead, 1.15% input, 1.53% output. Token consumption is overwhelmingly *context re-transmission × turn count*, not generation. A raw total is uninformative without the split and the cache-hit ratio.

### 3. WAL backup semantics (tested, not assumed)

A `/tmp` sandbox with a WAL DB, one committed row, and an open writer connection:

| scenario | copy `main` only | copy `main` + `-wal` |
|---|---|---|
| **writer open** | `ERROR: no such table: t` ❌ | 1 row ✅ |
| **after clean close** | row present ✅ | n/a (sidecars deleted) |

Findings:
- **`-shm` is pure scratch** — never needed in a backup; SQLite rebuilds it.
- While a writer is open, the main file alone can be **schema-less** (the `CREATE TABLE` itself still lived in the WAL).
- After a clean shutdown SQLite checkpoints and **deletes** `-wal`/`-shm`, so the main file alone is complete.
- `VACUUM INTO '<path>'` produces a single consistent self-contained file **even mid-session** — the correct backup method. (This was then used as the pre-flight test harness for SQL validation.)

### 4. Where does subagent consumption actually go?

Provenance of all 826 global runs, by `sessionFile`:

| origin | runs |
|---|---|
| `~/.pi/agent/sessions/…` (global identity) | 758 |
| `/tmp/pi-subagents/…` (global identity's subagents) | 6 |
| no `sessionFile` captured (pre-dates the field) | 62 |
| **partner agent dirs** | **0** |

Subagent runs contributed **6,943,517 tokens** across 6 runs — ~2× the orchestrator's per-run average, and substantial enough that ignoring them would badly understate consumption.

**A false positive was caught and corrected mid-investigation.** A first probe reported "partner sessions present: true". That matched raw JSONL *text*. The 12 real hits were **global-identity** runs whose *working directory* was a partner folder, encoded in pi's cwd slug: `agent/sessions/--home-pmpmt-.pi-explore-discover--/…`. Provenance is the agent dir, not the cwd. The remaining 13 matches were prompt text.

### 5. How pi spawns subagents — two packages, different fidelity

| | `@mjakl/pi-subagent` (`subagent` tool) | `pi-agents-pool` (`spawn_agent` tool) |
|---|---|---|
| Spawns via | its own runner | `spawn("pi", ["--mode","rpc","--session",file])` |
| `PI_SUBAGENT_DELEGATION` | ✅ `{version, childSessionId, parentSessionId, agent, handle}` — **but only when the child has a persistent session** | ❌ never |
| `PI_SUBAGENT_STACK` | ✅ always (ancestor chain + agent name) | ❌ never (unpatched) |
| `PI_SUBAGENT_DEPTH` | ✅ | ✅ |
| Parent recoverable from | payload or session path | **session path only** |

Supporting findings:
- **pi core deletes `PI_SESSION_ID` / `PI_SESSION_FILE` from child env** — children cannot inherit the parent's session id that way.
- `/tmp/pi-subagents` is **transient** — it was empty (0 files) during the audit. The recorded `session_file` path is therefore the only surviving link for `spawn_agent` children.
- A `subagent`-tool child with `initialContext: "empty"` gets **no payload and no session file** — it is genuinely unlinkable to its parent. Only its depth and stack (agent name) survive.

### 6. Git hygiene root cause

`.gitignore` already had `*.db`, `*.db-shm`, `*.db-wal`, `*.sqlite3` — but **not `*.sqlite`**. Commit `0bb5156` ("chore: ignore sqlite WAL sidecars") had fixed the `.db` case and missed the `.sqlite` extension entirely, so the same class of bug recurred. Only `agent/observability/runs.sqlite*` were tracked; the `.sqlite3` files elsewhere were correctly ignored.

Compounding factor: **another agent committed `3998c9b` mid-session** (not a cron job, not a git hook — a second `pi` process and Cursor agents were active in `~/.pi`), sweeping up the binaries plus `cron/jobs.json` and `pi-state-summary.md`.

### 7. Bugs found in the new code

| # | Bug | Severity | Caught by |
|---|---|---|---|
| 1 | `getDb()` assigned `sqliteDb` **before** `PRAGMA`/`SCHEMA_SQL`. A failure left a schemaless handle cached, so `getDb()` short-circuited forever and **every subsequent insert failed** for the rest of the session | Silent loss of all SQLite persistence | Fault injection (below) |
| 2 | `run_tokens` never exposed `tokens_input`/`tokens_cache_read`/`tokens_cache_write`/`tokens_output`, but `session_tokens` and `agent_tokens` referenced them | Views unusable | **Pre-flight SQL test against a `VACUUM INTO` copy** — before reaching the live path |
| 3 | Trailing comma in the `runs` INSERT placeholder list → `near ")": syntax error` | All SQLite inserts failed | Live child stderr from `persistRun`'s `console.error` |

Bug 1 was verified by fault injection, replicating only the pattern:

| | schema attempts over 3 calls | broken handle left cached? |
|---|---|---|
| **OLD** | 1 | **yes** ← the bug |
| **NEW** | 3 | no ← retries correctly |

---

## Architecture & Design Decisions

### Token-first, not cost-first

`cost_total` remains captured (it is free and already in `usage`) but is **not** the headline. Token dimensions are: prompt vs completion, the cache-hit ratio, and tokens-per-turn. Cost is provider-supplied and moves constantly.

### Query-time tree resolution, not insert-time

A child settles **before** its parent's run is recorded (the parent's `agent_settled` fires after its own turns, including the spawn). So a child cannot look up its parent's root at insert time. Resolution therefore happens in SQL, climbing a bounded 3 hops (matching the runtime guard's max depth of 3):

```
session_parent  → distinct session → parent map
session_root    → 3 LEFT JOINs, COALESCE to the topmost ancestor
```

Fixed-depth joins were chosen over a recursive CTE: deterministic, and trivially verifiable, since depth is bounded by the package guard.

### Lineage capture channels (priority order)

| channel | source | yields |
|---|---|---|
| 1 | `PI_SUBAGENT_DELEGATION` (validated against the **live session id**) | parent, agent, handle |
| 2 | `PI_SUBAGENT_STACK` (last element) | agent name |
| 3 | `PI_SUBAGENT_DEPTH` | depth |
| 4 | `<tmp>/pi-subagents/<parent>/<child>.jsonl` path | parent |

Validating the payload against the live session id is what makes a **stale payload harmless** — after a session switch inside a long-lived process, the payload names a different child and is ignored rather than mis-attributed to the wrong orchestrator.

### Before / After

| | Before | After |
|---|---|---|
| Sinks | `runs.jsonl` | `runs.jsonl` **+** `runs.sqlite` |
| Failure mode | — | SQLite failure logs and is non-fatal; JSONL stays authoritative |
| Run identity | flat list | tree via `parent_session_id` |
| Agent attribution | none | `agent_name`, `handle`, `depth` |
| Query surface | grep the JSONL | 5 SQL views |
| Reporting | none | `/tokens` command |
| `OBS_DIR` | `homedir()/.pi/agent/observability` (hardcoded) | `__dirname/../../observability` (per-agent) |

The `OBS_DIR` change is what makes per-agent isolation **structural**: the old hardcoded path meant a shared copy would pour every identity into one global sink.

### Deliberate exclusions

- **Forward-only (A1).** The 825 legacy JSONL runs are **not** backfilled. Measured first: 4,005 of 4,023 historical turns (99.6%) lack `provider`/`api`/`responseId`/`reasoning`, so imported rows would *look* complete while being empty in exactly the dimensions the schema exists for. A naive replay would also have thrown — binding `undefined` fails with `Provided value cannot be bound to SQLite parameter 1`, and 821 of 825 records lack `totals.tokens.reasoning`.
- **Global-only (E1).** `observability/` is not added to `partner-agents/shared/extensions/`. New partners do not receive it. (Also noted: `setup-pi-agent.sh`'s copy loop guards on `[ -f "$ext" ]`, so a directory would be **silently skipped** — shipping it would additionally need a `cp -r` branch.)

---

## Implementation

### Phase 0 — Git hygiene

- `.gitignore`: added `*.sqlite`, `*.sqlite-shm`, `*.sqlite-wal`, `*.sqlite-journal` (the missing half of the existing `*.db*` set), plus an `agent/observability/` block with a re-track comment.
- Untracked the 4 observability files with `git rm --cached` — files remain on disk.
- Verified: `git check-ignore` matches all four; `git ls-files | grep sqlite` returns nothing.

### Phase 1 — Lineage capture

- `RunRecord` + `parentSessionId`, `agentName`, `handle`, `depth`.
- `readDelegation(sessionId, sessionFile)` — the four channels above.
- `deriveParentSessionId()` — path convention via `join(tmpdir(), "pi-subagents") + sep`.
- `runs` table + 4 columns; `LINEAGE_COLUMNS` + an **idempotent `ALTER TABLE` migration** in `getDb()` so existing DBs upgrade in place.
- `getDb()` rewritten to initialise into a local and publish only on success:

```ts
const db = new DatabaseSync(SQLITE_PATH);
try {
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(SCHEMA_SQL);
  // …column migration + VIEWS_SQL
} catch (err) {
  try { db.close(); } catch {}
  sqliteDb = null;          // ← never cache a broken handle
  throw err;
}
sqliteDb = db;
```

### Phase 2 — Token views

Five views, dropped and recreated on every open:

| view | purpose |
|---|---|
| `session_parent` | distinct session → parent map |
| `session_root` | root session + `root_distance` |
| `run_tokens` | per-run `prompt_tokens`, `completion_tokens`, `reasoning_tokens`, `cache_hit_ratio`, `tokens_per_turn` |
| `session_tokens` | per-root rollup (orchestrator + all descendants) |
| `agent_tokens` | all-time rollup by agent |

### Phase 3 — `/tokens` command

`pi.registerCommand("tokens")` + `fmt()`, `shortId()`, `tokenReport()`: root-session total, prompt/completion split with the cache-hit ratio, per-agent breakdown, subagent list with depth, and all-time totals by agent.

### Phase 4 — `pi-agents-pool` patch

`launchProcess` now exports `PI_SUBAGENT_STACK` (inherited chain + this child's `agentType`), mirroring `@mjakl/pi-subagent`'s convention. The extension needed **no** change — it already read that variable. Wiring verified: `index.ts:290 agentType: params.agent_type` → `agent-pool.ts:185 { agentType: options.agentType }` → patched line 425.

### Phase 5 — VPS transplant

Ordering was chosen so a broken file could never go live:

1. Back up the VPS file + record its hash.
2. Copy to `index.ts.new` (not in place).
3. **Hash gate** — local vs remote compared; only then promote.
4. **Load check before promote** — copied to `index.check.ts` (type-stripping keys off the `.ts` extension) and imported with the VPS's own node.
5. Promote + re-verify hash.
6. Back up and patch `pi-agents-pool` with a **guarded, anchored** replacement that aborts unless the anchor matches exactly once.
7. First live session; then query the DB, test lineage, test `/tokens`.
8. Remove test debris and scratch files.

Test debris was cleaned by filtering both sinks for synthetic records (`VPSTEST`), deleting `tool_calls` → `turns` → `runs` in FK order, and rewriting the JSONL via **temp file + atomic rename**.

---

## Verification

| test | result |
|---|---|
| Token accounting vs pi session files (7 runs, all fields) | ✅ 1.00× |
| `node:sqlite` on VPS launcher node (v24.21.0) | ✅ `DatabaseSync: function` |
| `node:sqlite` on VPS system node (v22.22.2) | ✅ (experimental warning only) |
| New SQL vs a `VACUUM INTO` copy of the live DB | ✅ 5 views created |
| INSERT static check | ✅ 32 columns / 32 placeholders, prepares clean |
| Migration applied by a child process (live DB) | ✅ columns + views present |
| Payload child → SQLite | ✅ `parent=SIMPARENT, agent=simagent, handle=simhandle, depth=1` |
| Path-only child (`spawn_agent` case) | ✅ `parent=PARENT2, agent=null` |
| Stack-only child | ✅ `agent=researcher, parent=null, depth=1` |
| Tree walk | ✅ `root_distance=1`, root resolves to parent |
| Real `subagent`-tool child | ✅ `agent=researcher, depth=1, parent=null` |
| Real `spawn_agent` child | ✅ `parent=<orchestrator session>, agent=null` |
| 12 event subscriptions intact | ✅ |
| `/tokens` handler invoked with a real ctx | ✅ |
| VPS extension hash | ✅ `8f16e31f…` = byte-identical to local |
| VPS first live session (pi **1.0.0**) | ✅ exit 0, zero observability errors, `runs.sqlite` created |
| VPS lineage end-to-end | ✅ `parent VPSTEST / agent vpsagent / handle vpshandle / depth 1` |
| VPS `/tokens` | ✅ rendered, including subagent breakdown by name |
| VPS debris cleanup | ✅ 24 JSONL lines (23 legacy + 1 real run), 1 run in SQLite |
| Rollback artifacts | ✅ 3 `.bak` files on the VPS |

**Live `/tokens` output (local orchestrator session):**

```
Tokens — this session + subagents (01a105ea)
  total        9,683,992
  prompt       9,576,005  = input 68,293 + cacheRead 9,507,712
  completion   107,987  (reasoning 69,822 is a subset)
  cache hit    99.3%
  10 runs (1 subagent) · 90 turns · 77 tools

  by agent (this session)
    (orchestrator)             9,662,014  (9 runs)
    (unnamed subagent)            21,978  (1 runs)

  subagent runs
    01a10615  d1  (unnamed)             21,978

  all-time by agent (whole DB)
    (orchestrator)             9,662,014  (9 runs)
    researcher                    27,964  (2 runs)
    (unnamed subagent)            21,978  (1 runs)
```

`reasoning` is **64.7%** of completion tokens (69,822 / 107,987) — a materially large share of generation.

---

## Bugs Introduced During Implementation (and how they were caught)

Recorded deliberately: two of the three were caught by the pre-flight harness, not by luck.

| # | Bug | Caught by |
|---|---|---|
| 1 | Trailing comma in the INSERT placeholders (my edit added `?, ?,` where the original line was last and had none) | The **live child's stderr** — exactly what `persistRun`'s `console.error` exists for. JSONL was already written, so no data was lost |
| 2 | `run_tokens` missing the raw token columns that `session_tokens`/`agent_tokens` referenced | The **pre-flight test against a `VACUUM INTO` copy** — before it reached the live path |
| 3 | Several `oldText` transcription errors (omitted import line, mis-transcribed placeholder block) and one wrong path (`agent/observability` vs `agent/extensions/observability`) | The edit tool's exact-match failure and a module-not-found error. Corrected by **reading the exact text** rather than reconstructing it |

The `VACUUM INTO` copy test was justified by the WAL investigation in §3 — it produced a consistent snapshot of the live database without touching it, and it caught a real defect.

---

## Limitations & Future Work

1. **The `spawn_agent` pool patch is not verified end-to-end on either machine.** It is verified by syntax check plus wiring inspection. Confirming it requires a fresh `pi` process that genuinely calls `spawn_agent`, which is non-deterministic. The `VPSTEST` test validated the extension's *reader* (hand-set env), not the pool's *writer*.
2. **The patch lives in `node_modules`** — wiped by any package upgrade. Recorded in both machines' `pi-state-summary.md`; consider an upstream PR or a fork.
3. **`resume_agent` passes no `agentType`** (`agent-pool.ts:367`), so resumed agents stay nameless. Same bug family, not yet fixed.
4. **`subagent` children with `initialContext: "empty"` are unlinkable to their parent** — no payload and no session file. They record `depth` and `agent_name` (via the stack) but become their own root, so session-level rollups miss them.
5. **`node:sqlite` is upstream-experimental.** The `ALTER TABLE` migration path is the thing to re-test on a Node bump.
6. **pi 1.0.0 has hosted the new code for exactly one session.** The local machine runs 1.0.2.
7. **`/tokens` requires `/reload`** in an already-running session.
8. **History still contains the binary blobs** committed in `3998c9b`. `runs.jsonl` also exists as 62 historical blobs; the repo is ~31 MiB of loose objects with no packs, plus a stray `garbage: .git/objects/54/tmp_obj_fuj1qz`. Purging requires a history rewrite (force-push), not yet done.
9. **The VPS's 23 legacy runs remain JSONL-only** (A1 by design). The VPS `~/.pi` is not a git repo, so the `.gitignore`/untracking work does not apply there.
10. **An unaccounted auto-committer exists** in `~/.pi` — another agent committed mid-session. Worth identifying separately, since it contradicts the operator's stated no-auto-commit preference.

---

## Files Created/Modified

| File | Lines | Change | Purpose |
|---|---|---|---|
| `~/.pi/agent/extensions/observability/index.ts` | **1123** (+380/−88, then +371/−11 from 471) | modified | SQLite dual-write, lineage, views, `/tokens` |
| `~/.pi/.gitignore` | +9 | modified | sqlite/WAL ignore rules + `agent/observability/` |
| `~/.pi/agent/npm/node_modules/pi-agents-pool/extension/agent-pool.ts` | +18 | modified (local patch) | exports `PI_SUBAGENT_STACK` from `launchProcess` |
| `~/.pi/docs/pi-state-summary.md` | +7 | modified | inventory: observability capability + patched package |
| `~/.pi/agent/observability/runs.sqlite` | 45 KB | created | query surface (local: 12 runs / 89 turns / 77 tool_calls) |
| **VPS** `~/.pi/agent/extensions/observability/index.ts` | **1123** (from 471) | replaced | transplanted; sha256 `8f16e31f…` |
| **VPS** `…/pi-agents-pool/extension/agent-pool.ts` | +18 | modified | same patch |
| **VPS** `~/.pi/docs/pi-state-summary.md` | 164 (unchanged count) | modified | inventory rows |
| **VPS** `~/.pi/agent/observability/runs.sqlite` | 45 KB | created | 1 real run |

### Rollback artifacts (VPS)

```
~/.pi/agent/extensions/observability/index.ts.bak-20261004-101311          # 471-line original
…/pi-agents-pool/extension/agent-pool.ts.bak-20261004-091329
~/.pi/docs/pi-state-summary.md.bak-20261004-091434
```

The extension is stateless — restore the `.bak`, and delete `runs.sqlite` for a clean slate.

---

## Cross-References

- `~/.pi/docs/token-usage-dashboard-setup/token-usage-dashboard-setup.md` — the older, separate web dashboard at `~/.pi/html/` that imports session JSONL into its own SQLite DB. **Different system, overlapping subject**: that one is a manual/imported browser dashboard; this one is an in-process extension writing a per-run tree with delegation lineage.
- `~/.pi/docs/multi-agent-orchestrator-setup/multi-agent-orchestrator-setup.md` — the orchestrator/subagent architecture whose consumption this report makes attributable.
- `~/.pi/docs/pi-state-summary.md` — living inventory (updated on both machines).
