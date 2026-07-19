# Pi Cron Job System — Setup & Implementation Report

**Date:** 2026-07-17
**System:** Ubuntu 24.04 (Pi v0.80.x)
**Location:** `~/.pi/cron/` (engine) + `~/.pi/agent/extensions/cron.ts` (extension)

---

## Problem

Pi lacks a built-in scheduled-task system. Without cron, the agent can only work reactively — a user has to open a session and give a prompt. There is no way to say "summarize my inbox every morning at 7 AM" or "check this API every 30 minutes" without an external scheduler (systemd timer, crontab, etc.) and brittle shell wrappers around `pi --print`.

The goal: bring OpenClaw-grade cron scheduling into Pi as a first-class feature — persistent jobs, a CLI management surface, and an agent-accessible tool — all without requiring a separate Gateway process.

---

## Research Phase

### Web Searches Performed

The research targeted OpenClaw's cron implementation, which is the reference architecture for AI-agent scheduling:

| # | Search Query | Focus |
|---|---|---|
| 1 | `OpenCLaw cron jobs scheduling automation` | High-level architecture & CLI surface |
| 2 | `OpenCLaw pi agent cron system architecture` | Service design, dependency injection, timer |
| 3 | `OpenCLaw cron folder structure jobs database` | Persistence model (JSON → SQLite migration) |
| 4 | `OpenCLaw cron job metadata enabled disabled registration` | State machine, session binding, archival behavior |
| 5 | `site:github.com/openclaw/openclaw cron` | Source code references |

### Sources Analyzed

- **`docs.openclaw.ai/automation/cron-jobs`** — The authoritative documentation: schedule types, payloads, execution styles, delivery modes, failure alerts, CLI reference.
- **`openclawbook.xyz/en/ch18-cron-scheduling-and-automation/18.1-cron-system-design`** — Deep-dive into `CronService`, `ops.ts`, `schedule.ts`, `normalize.ts`, timer mechanism, croner library.
- **`github.com/openclaw/openclaw/src/cron/types.ts`** — Complete type system: `CronJob`, `CronSchedule`, `CronPayload`, `CronJobState`, `CronRunOutcome`, `CronStoreFile`.
- **`github.com/openclaw/openclaw/src/agents/tools/cron-tool.ts`** — Agent-facing tool schema, canonicalization, normalization, gateway-call dispatching.

### Key Findings

1. **Cron runs inside the Gateway process**, not the model. For Pi (no Gateway), we needed an in-process scheduler running inside the extension.

2. **Persistence evolved from JSON files to SQLite**, but the JSON file-as-database pattern (`CronStoreFile = { version, jobs[] }`) is well-documented and perfect for a single-user Pi instance.

3. **The timer is capped at 60 seconds** max delay, not because of precision, but because JavaScript `setTimeout` drifts after system sleep (laptop lid close). Waking every minute catches up missed jobs.

4. **Normalization is critical** — LLMs produce dirty input (wrong casing, legacy field names, missing defaults). OpenClaw has a dedicated `normalize.ts` with separate `normalizeCronJobCreate` (applies defaults) and `normalizeCronJobPatch` (only touches explicit fields).

5. **Three schedule types**: `at` (one-shot ISO/relative), `every` (fixed interval with anchor mechanism), `cron` (expression parsed by croner library).

6. **Run history is per-job JSONL** — append-only, newest-first retrieval, kept for audit.

---

## Architecture Decisions

### What We Kept from OpenClaw

- **Job shape**: `{ id, name, schedule, payload, enabled, state }` with runtime state colocated on the job.
- **Three schedule types**: `at`, `every`, `cron` — same semantics, same normalization.
- **60-second cap on `setTimeout`** for system-sleep recovery.
- **Anchor mechanism for `every` jobs** — `anchor + N × everyMs` ensures interval stability across restarts.
- **Separate create vs. patch normalization** — prevents default application on edits.
- **Run history as JSONL** per job, newest-first.
- **Stale `runningAtMs` marker clearing on startup** — crash recovery.
- **Auto-delete for one-shot `at` jobs** after first success (with `deleteAfterRun` default).
- **Agent tool with actions**: `status`, `list`, `get`, `add`, `update`, `remove`, `run`, `runs`.

### What We Simplified

| OpenClaw | Pi Cron | Reason |
|---|---|---|
| SQLite state DB | JSON file (`~/.pi/cron/jobs.json`) | Single-user, no concurrent writes needed |
| Gateway process | Pi extension in-process | Pi has no Gateway server |
| croner library | Hand-rolled cron parser | Avoid npm dependency; handles standard 5-field expressions |
| Delivery channels (Telegram, Slack, webhooks) | `log` only (run history) | Pi is terminal-first; delivery can be added later |
| Failure alerts, retry backoff | `consecutiveErrors` counter | Simpler; errors visible in run history |
| Event triggers (condition watchers) | Not implemented | Requires headless code execution sandbox |
| `sessionTarget` (main/isolated/current/custom) | Always `isolated` (spawns `pi --print`) | Pi has no multi-session Gateway |
| `on-exit` schedule kind | Not implemented | Requires Gateway process supervisor |

### File Layout

```
~/.pi/
├── cron/
│   ├── jobs.json              ← Persistent job register
│   ├── runs/
│   │   └── <jobId>.jsonl      ← Append-only run history per job
│   ├── types.ts               ← Full type system
│   ├── store.ts               ← Load/save/persist + run log
│   ├── schedule.ts            ← computeNextRunAtMs + cron parser + timer
│   └── normalize.ts           ← LLM input normalization
└── agent/
    └── extensions/
        └── cron.ts            ← Pi extension entry point
```

---

## Implementation Phases

### Phase 1 — Types & Store

**Files:** `types.ts`, `store.ts`

Defined the `CronJob` shape with all metadata (schedule, payload, delivery, enabled/disabled, state tracking) and built the JSON persistence layer with `loadStore()`, `saveStore()`, `persistJob()`, `removeJobFromStore()`. Added append-only run logging via `appendRunLog()` and `getRunHistory()` with JSONL per job.

### Phase 2 — Scheduling Engine

**File:** `schedule.ts`

Implemented `computeNextRunAtMs()` supporting all three schedule types:
- **`at`**: Parses ISO-8601 datetimes and relative times (`"20m"`, `"1h"`, `"1d"`) via regex
- **`every`**: Anchor-based interval calculation (`anchor + N × everyMs`)
- **`cron`**: Hand-written 5-field cron parser (minute, hour, day-of-month, month, day-of-week) with wildcards, ranges, steps, and OR-logic for dom/dow

The timer (`armTimer`) finds the nearest upcoming job across all enabled jobs and sets a `setTimeout` capped at `MAX_TIMER_DELAY_MS = 60_000`. Uses `timer.unref()` to allow the process to exit in print mode while keeping the timer alive in interactive (TUI) mode.

### Phase 3 — Normalization

**File:** `normalize.ts`

Handles the dirty reality of LLM-generated cron job input:
- Case correction: `agentturn` → `agentTurn`, `systemevent` → `systemEvent`
- Auto-inference: missing `kind` inferred from `message` (agentTurn) or `text` (systemEvent)
- Default application: `enabled: true`, `delivery.mode: "log"`, `deleteAfterRun` defaults to `true` for `at` jobs
- Patch safety: edits only touch explicitly provided fields

### Phase 4 — Pi Extension

**File:** `~/.pi/agent/extensions/cron.ts`

The extension wires everything together:

```
Startup:
  loadStore() → clear stale runningAtMs → recomputeNextRuns() → armTimer()

Runtime (timer loop):
  setTimeout(60s max) → onTimer() → execute due jobs → recompute → armTimer()

Execution (per job):
  spawn("pi", ["--print", "--no-session", "--name", "cron:<name>", prompt])
  → capture stdout/stderr → record run log → persist state

Shutdown:
  session_end → clearTimeout(timer)
```

Registers:
- **`/cron` command** (TUI-only): status, list, add, enable, disable, remove, run, runs — with interactive select/input/confirm dialogs
- **`cron` tool** (agent-accessible): full CRUD + run + run history — TypeBox schema with descriptions for the model

### Phase 5 — Testing

End-to-end verification:
1. `cron status` → scheduler enabled, 0 jobs ✓
2. `cron add` → job created with correct schedule and payload ✓
3. `cron list` → job visible with name, enabled, nextRunAtMs ✓
4. `cron get` → full job detail returned ✓
5. `cron run` → spawned `pi --print`, captured output, recorded run log ✓
6. `cron runs` → run history retrieved ✓
7. `cron update` (disable) → job disabled ✓
8. `cron remove` → job deleted ✓

Print-mode exit confirmed working — `timer.unref()` allows clean process exit.

---

## Configuration

### Store Location

Default: `~/.pi/cron/jobs.json`

Override via `PI_CODING_AGENT_DIR` — the cron directory resolves relative to that.

### Job Schema

```typescript
type CronJob = {
  id: string;                    // auto-generated: cron-<ts36>-<rand6>
  name: string;                  // required, human-readable
  schedule: {
    kind: "at" | "every" | "cron";
    at?: string;                 // ISO-8601 or relative ("20m", "1h")
    everyMs?: number;            // milliseconds
    anchorMs?: number;           // interval reference point
    expr?: string;               // 5-field cron expression
    tz?: string;                 // IANA timezone (default: host)
  };
  payload: {
    kind: "agentTurn" | "systemEvent";
    message?: string;            // agentTurn prompt
    text?: string;               // systemEvent text
    model?: string;              // model override
    thinking?: string;           // thinking level override
    timeoutSeconds?: number;     // per-run timeout
  };
  delivery: { mode: "none" | "log" };
  enabled: boolean;
  deleteAfterRun?: boolean;      // auto-delete after first success
  description?: string;
  createdAtMs: number;
  updatedAtMs: number;
  state: {
    nextRunAtMs?: number;
    runningAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: "ok" | "error" | "skipped";
    lastError?: string;
    lastDurationMs?: number;
    consecutiveErrors?: number;
  };
};
```

---

## Usage Quick Reference

### Via the agent (cron tool)

```
"Create a job named 'Morning Brief' that runs every day at 7 AM Europe/Lisbon
with the prompt 'Summarize any important overnight emails and news.'"

"List all cron jobs"

"Force-run the Morning Brief job now"

"Show me the run history for the Morning Brief job"

"Disable the Morning Brief job"
```

### Via /cron command (interactive only)

```
/cron status           — scheduler health, job count
/cron list             — browse jobs, select for detail
/cron add              — interactive creation wizard
/cron enable <prefix>  — enable by ID prefix
/cron disable <prefix> — disable by ID prefix
/cron run <prefix>     — force-run now
/cron runs <prefix>    — view run history
/cron remove <prefix>  — delete (with confirmation)
```

### Schedule Examples

| Schedule | Input |
|---|---|
| One-shot in 20 minutes | `{ kind: "at", at: "20m" }` |
| One-shot at specific time | `{ kind: "at", at: "2027-03-01T09:00:00Z" }` |
| Every 30 minutes | `{ kind: "every", everyMs: 1800000 }` |
| Every weekday at 7 AM Lisbon | `{ kind: "cron", expr: "0 7 * * 1-5", tz: "Europe/Lisbon" }` |
| Every hour | `{ kind: "cron", expr: "0 * * * *" }` |

---

## Limitations & Future Work

1. **Cron only fires when Pi is running interactively.** The timer uses `setTimeout` which only fires while the Pi TUI session is active. For always-on scheduling, pair with systemd or a separate long-running Pi process.

2. **No delivery channels.** Output is logged to run history only. Future: Telegram/Slack/Discord/webhook delivery.

3. **No event triggers.** OpenClaw's condition-watcher scripts (`trigger.script`) are not implemented. Requires headless code execution sandbox.

4. **No retry/backoff.** Transient failures are recorded but not retried. Future: configurable retry with exponential backoff.

5. **No failure alerts.** Consecutive error count is tracked but no notification is sent. Future: webhook or chat alert on N consecutive failures.

6. **Cron expression parser is hand-rolled.** Handles standard 5-field expressions but misses some croner edge cases (L, W, #, 6-field with seconds). Future: optionally depend on croner npm package.

---

## Files Created

| File | Lines | Purpose |
|---|---|---|
| `~/.pi/cron/types.ts` | ~55 | Type definitions |
| `~/.pi/cron/store.ts` | ~80 | JSON persistence + run log |
| `~/.pi/cron/schedule.ts` | ~145 | Scheduling engine + cron parser |
| `~/.pi/cron/normalize.ts` | ~105 | LLM input normalization |
| `~/.pi/agent/extensions/cron.ts` | ~520 | Pi extension (entry point) |
| `~/.pi/cron/jobs.json` | 3 | Initial store file |
| **Total** | **~908** | |
