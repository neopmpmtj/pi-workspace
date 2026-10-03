# Pi Extension Discovery & Event Lifecycle — Investigation Report

**Date:** 2026-07-23
**System:** Ubuntu 24.04 (Pi v0.81.1)
**Location:** `~/.pi/agent/extensions/dummy/index.ts` (tracer), `~/.pi/agent-frontend/extensions/agent-frontend-dummy/index.ts` (control), `~/.pi/.pi/extensions/project-dummy/index.ts.disabled` (control)

---

## Problem

How does Pi discover and load extensions at session startup? Which directories are scanned? In what order do lifecycle events fire when a prompt is processed? The goal was to map Pi's inner flow empirically — from extension factory execution through the full agent run lifecycle — without relying on undocumented assumptions.

---

## Investigation

### Phase 1 — Extension Discovery: Global vs. Project vs. Parallel Agent Dirs

Pi's `~/.pi/` directory contained two agent config directories — `agent/` (the default global config) and `agent-frontend/` (a parallel config for front-end work). It was unclear whether Pi would auto-load extensions from both, one, or neither.

Three dummy extensions were planted, each logging a distinct tag to the console:

| Tag | Location | Expected Behavior |
|-----|----------|-------------------|
| `[AGENT-DUMMY]` | `~/.pi/agent/extensions/dummy/index.ts` | Should load (global) |
| `[AGENT-FRONTEND-DUMMY]` | `~/.pi/agent-frontend/extensions/agent-frontend-dummy/index.ts` | Unknown |
| `[PROJECT-DUMMY]` | `~/.pi/.pi/extensions/project-dummy/index.ts` | Should load (project-local, cwd=`~/.pi/`) |

**Result:**

```
[AGENT-DUMMY] ~/.pi/agent/extensions/dummy/index.ts — LOADED!
[PROJECT-DUMMY] ~/.pi/.pi/extensions/project-dummy/index.ts — LOADED!
```

`[AGENT-FRONTEND-DUMMY]` **never fired** — not from cwd=`~/.pi/`, not from cwd=`~/.pi/agent-frontend/`.

**Finding:** Pi has **two additive extension tiers**:

| Tier | Path | Scope |
|------|------|-------|
| **Global** | `~/.pi/agent/extensions/` | Fixed — loads for every session, regardless of cwd |
| **Project-local** | `<cwd>/.pi/extensions/` | Moves with cwd — loads in addition to global |

Both tiers fire on startup. There is exactly **one global config directory** (`~/.pi/agent/`, overridable via `PI_CODING_AGENT_DIR`). It does not recursively scan for sibling `agent-*` directories. The `agent-frontend/` directory — despite having the same internal structure (its own `extensions/`, `skills/`, `settings.json`, `sessions/`) — is an *alternative* global config, invisible unless `PI_CODING_AGENT_DIR` targets it. It does not auto-load alongside `agent/`.

**Finding:** Project-local discovery is `<cwd>/.pi/extensions/`. When cwd is `~/.pi/`, this resolves to `~/.pi/.pi/extensions/` — not a double-`.pi` convention, just `<cwd>` + `.pi/extensions/`. Both dummies fire: `[AGENT-DUMMY]` from global and `[PROJECT-DUMMY]` from project-local.

### Phase 2 — Event Lifecycle: console.log Failure

The agent dummy was extended to subscribe to 17 lifecycle events and log them via `console.log`. However, the trace was incomplete:

| Events that appeared | Events missing |
|----------------------|----------------|
| `input`, `before_agent_start`, `agent_start`, `turn_start` | `context`, `turn_end`, `agent_end`, `agent_settled` |
| `message_start` (user), `message_end` (user) | `tool_call`, `tool_execution_start`, `tool_execution_update` |
| `message_end` (assistant) | `tool_result`, `tool_execution_end` |
| | `message_start` (toolResult), `message_end` (toolResult) |

**Root cause:** Pi's TUI owns the terminal. `console.log` writes to stdout, which the TUI rendering loop either buffers, overwrites, or discards during active rendering cycles. Events that fire *before* the TUI renders (early startup) make it through; events that fire *during* rendering (tool execution, turn transitions) are swallowed.

### Phase 3 — Event Lifecycle: File-Based Logging (Fixed)

Replaced `console.log` with `appendFileSync` to `/tmp/pi-event-trace.log`. This bypasses the TUI entirely. The log is cleared on each startup so each session produces a fresh trace.

**Result:** All 17 event types now appear reliably in order, with millisecond timestamps.

---

## Full Lifecycle Trace (Annotated)

Two test prompts were sent: `"hello"` (no tools) and `"what is the date and time now?"` (LLM calls `bash date`).

### Prompt: "hello" — No Tools

```
11:25:42.059  input ────────────────────── "hello" | source: interactive | idle
11:25:42.060  before_agent_start ───────── prompt received, system prompt assembled
11:25:42.064  agent_start ──────────────── run begins
              ┌─ turn #0 ───────────────────────────────────────────┐
11:25:42.067  │  turn_start                                        │
11:25:42.067  │  message_start — role: user                        │
11:25:42.069  │  message_end   — role: user | contentLen: 32      │
11:25:42.070  │  context — messages: 1 (sent to LLM)              │
11:25:42.769  │  message_start — role: assistant (streaming)      │
11:25:43.760  │  message_end   — role: assistant | contentLen: 244│
11:25:43.761  │  turn_end — tools: none                           │
              └─────────────────────────────────────────────────────┘
11:25:43.762  agent_end — 2 messages produced
11:25:43.764  agent_settled — fully idle (no retries/compaction/follow-up)
```

### Prompt: "what is the date and time now?" — Tool Call

```
11:26:09.347  input ────────────────────── "what is the date and time now?"
11:26:09.348  before_agent_start
11:26:09.349  agent_start
              ┌─ turn #0 ───────────────────────────────────────────┐
11:26:09.350  │  turn_start                                        │
11:26:09.350  │  message_start — role: user                        │
11:26:09.350  │  message_end   — role: user | contentLen: 57      │
11:26:09.351  │  context — messages: 3 (includes hello history)   │
11:26:10.006  │  message_start — role: assistant                   │
11:26:11.070  │  message_end   — assistant | contentLen: 284       │
              │                                                    │
              │  ┌─ Tool execution: bash ──────────────────────┐    │
11:26:11.071  │  │  tool_execution_start                      │    │
11:26:11.077  │  │  tool_call (can BLOCK here)                │    │
11:26:11.082  │  │  tool_execution_update (streaming output)  │    │
11:26:11.094  │  │  tool_execution_update                     │    │
11:26:11.098  │  │  tool_result (can MODIFY here)             │    │
11:26:11.098  │  │  tool_execution_end | isError: false       │    │
11:26:11.099  │  │  message_start — role: toolResult          │    │
11:26:11.099  │  │  message_end   — role: toolResult          │    │
              │  └────────────────────────────────────────────┘    │
11:26:11.099  │  turn_end — tools: bash                           │
              └─────────────────────────────────────────────────────┘
              ┌─ turn #1 ───────────────────────────────────────────┐
11:26:11.100  │  turn_start                                        │
11:26:11.100  │  context — messages: 5 (includes toolResult)      │
11:26:11.644  │  message_start — role: assistant                   │
11:26:13.106  │  message_end   — assistant | contentLen: 354       │
11:26:13.106  │  turn_end — tools: none                           │
              └─────────────────────────────────────────────────────┘
11:26:13.107  agent_end — 4 messages produced
11:26:13.107  agent_settled — fully idle
```

---

## Key Findings

### 1. Three Nested Loops

As described in the Pi Agent Harness report, the flow has three nesting levels:

| Loop | Scope | Boundary |
|------|-------|----------|
| **Interactive** | Waits for terminal input | `session_shutdown` / quit |
| **Agent run** | One prompt → `agent_start` … `agent_settled` | `agent_end` may be followed by retry/compaction/follow-up |
| **Turn** | One LLM request + response + tool batch | `turn_start` … `turn_end` |

One prompt can produce multiple turns. The second prompt above took 2 turns: one for the `bash date` tool call, one for the LLM to format the answer.

### 2. Message Count Accumulates Across Turns

The `context` event shows the full message count sent to the LLM each turn:

- Turn #0 of `"hello"`: **1 message** (just the new user message)
- Turn #0 of date prompt: **3 messages** (hello history + new user message)
- Turn #1 of date prompt: **5 messages** (history + user + assistant-toolcall + toolResult + assistant-final)

Pi resends the complete transcript on every model call. It does not depend on the remote model remembering a previous API request.

### 3. Tool Execution Has 6 Discrete Stages

| Stage | Event | Can Intercept? |
|-------|-------|---------------|
| Pre-flight | `tool_execution_start` | Read-only |
| Validation | `tool_call` | **BLOCK** (`{ block: true }`) |
| Streaming | `tool_execution_update` (×N) | Read-only |
| Post-exec | `tool_result` | **MODIFY** (content, details, isError) |
| Final | `tool_execution_end` | Read-only |
| Transcript | `message_start/end` (toolResult) | Read-only via `message_end` |

This matches the documentation — extensions can block tool execution at `tool_call` and modify results at `tool_result`.

### 4. `agent_settled` Is the True "Done" Signal

`agent_end` fires when the low-level agent run finishes, but Pi may auto-retry, auto-compact, or continue with queued follow-up messages. `agent_settled` means no more automatic work remains. For status integrations, use `agent_settled`, not `agent_end`.

### 5. Turn Indices Reset Per Run

Both prompts started at `turn #0`. Turn indices are scoped to the agent run, not the session.

### 6. Extension Discovery: Two Additive Tiers, Not Recursive

| Directory | Loaded? | Mechanism |
|-----------|---------|-----------|
| `~/.pi/agent/extensions/` | ✅ Always | Global — one fixed dir (`PI_CODING_AGENT_DIR` overrides) |
| `<cwd>/.pi/extensions/` | ✅ If exists | Project-local — additive, moves with cwd |
| `~/.pi/agent-frontend/extensions/` | ❌ Never | Alternative global — only if `PI_CODING_AGENT_DIR` targets it |

Pi does not scan for sibling `agent-*` directories or recursively discover `index.ts` files. Extensions from global and project-local both fire — they are cumulative, not mutually exclusive.

### What loads within each extensions directory

| Pattern | Example | Loads? |
|---------|---------|--------|
| `extensions/*.ts` | `cron.ts`, `git-commit.ts` | ✅ Any `.ts` file at the root of the directory |
| `extensions/*/index.ts` | `observability/index.ts` | ✅ `index.ts` inside a subdirectory (the subdirectory's entry point) |
| `extensions/*/helpers.ts` | `observability/helpers.ts` | ❌ Does NOT auto-load — only runs if `index.ts` imports it |

Files at the root load by any name. Subdirectories use `index.ts` as the gate — this allows multi-file extensions without every `.ts` file auto-executing.

**Load order within a tier:** files first, then subdirectories (alphabetical within each group).

---

## Complete Event Registry

The tracer now registers handlers for **all 28 documented lifecycle events**:

```
STARTUP (3):      project_trust → session_start → resources_discover
INPUT (1):        input [HOOK]
AGENT (4):        before_agent_start [HOOK] → agent_start → agent_end → agent_settled
TURN (2):         turn_start → turn_end
MESSAGE (3):      message_start → message_update → message_end [HOOK]
TOOL (5):         tool_execution_start → tool_call [HOOK] → tool_execution_update
                  → tool_result [HOOK] → tool_execution_end
CONTEXT (1):      context [HOOK]
PROVIDER (2):     before_provider_headers [HOOK] → after_provider_response
SESSION (8):      session_info_changed → session_before_switch [HOOK]
                  → session_before_fork [HOOK] → session_before_compact [HOOK]
                  → session_compact → session_before_tree [HOOK] → session_tree
                  → session_shutdown
MODEL (2):        model_select → thinking_level_select
USER BASH (1):    user_bash [HOOK]
```

### Events Not Yet Verified (require manual triggering)

These are registered but have not been tested in live sessions:

- **Session navigation**: `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_compact`, `session_before_tree`, `session_tree` — triggered by `/new`, `/resume`, `/fork`, `/clone`, `/compact`, `/tree`
- **Session rename**: `session_info_changed` — triggered by `/name`
- **Model/thinking**: `model_select`, `thinking_level_select` — triggered by `/model`, Ctrl+P, Shift+Tab
- **Provider HTTP**: `before_provider_headers`, `after_provider_response` — fire on every LLM request
- **User bash**: `user_bash` — triggered by `!command` or `!!command` in the editor

All event signatures are documented in `~/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`.

---

## Files Created/Modified

| File | Lines | Purpose |
|------|-------|---------|
| `~/.pi/agent/extensions/dummy/index.ts` | 201 | Full lifecycle tracer (timestamped log per session: `/tmp/pi-event-trace-<iso>.log`) |
| `~/.pi/agent-frontend/extensions/agent-frontend-dummy/index.ts` | 16 | Control extension — proved NOT auto-loaded |
| `~/.pi/.pi/extensions/project-dummy/index.ts.disabled` | 17 | Control extension — proved project-local loading, now disabled |
| `/tmp/pi-event-trace-*.log` | — | Trace output (one file per session, never wiped) |
| **Total** | **234** | |

---

## Usage

To trace a Pi session:

1. Ensure the tracer is enabled: `~/.pi/agent/extensions/dummy/index.ts` must exist with `.ts` extension
2. Start Pi normally from any project directory
3. Interact normally
4. After the session: `cat /tmp/pi-event-trace.log`

The log is cleared on each startup. To preserve traces across sessions, copy the file before restarting Pi.

To disable the tracer, rename `index.ts` → `index.ts.disabled` and `/reload`.

---

## Events vs. Hooks

Pi calls everything "events" and uses a uniform `pi.on(...)` API, but the handler signatures reveal two distinct categories:

### Hooks (12) — Return values control behavior

| Hook | What it can do | Return shape |
|------|---------------|--------------|
| `input` | Handle entirely, transform text, or pass through | `{ action: "handled" \| "transform" \| "continue" }` |
| `before_agent_start` | Inject a message, modify system prompt | `{ message?, systemPrompt? }` |
| `message_end` | Replace the finalized message (same role) | `{ message }` |
| `tool_call` | Block execution | `{ block: true, reason? }` |
| `tool_result` | Modify content, details, isError, usage | `{ content?, details?, isError?, usage? }` |
| `context` | Filter or modify messages before LLM call | `{ messages }` |
| `before_provider_headers` | Add, override, or delete HTTP headers (mutate in-place) | Mutate `event.headers` |
| `user_bash` | Intercept `!`/`!!` commands, replace execution | `{ operations? }` or `{ result? }` |
| `session_before_switch` | Cancel session switch | `{ cancel: true }` |
| `session_before_fork` | Cancel fork/clone | `{ cancel: true }` |
| `session_before_compact` | Cancel compaction or provide custom summary | `{ cancel: true }` or `{ compaction: {...} }` |
| `session_before_tree` | Cancel tree navigation or provide custom summary | `{ cancel: true }` or `{ summary: {...} }` |

### Events (16) — Pure notification, return values ignored

| Event | Fires when |
|-------|-----------|
| `project_trust` | Project trust decision needed |
| `session_start` | Session created, loaded, or reloaded |
| `resources_discover` | After `session_start` (startup or reload) |
| `session_info_changed` | `/name` or `pi.setSessionName()` |
| `session_compact` | Compaction entry written |
| `session_tree` | Tree navigation complete |
| `session_shutdown` | Session runtime torn down |
| `agent_start` | Agent run begins |
| `agent_end` | Agent run ends (retry/compaction may follow) |
| `agent_settled` | Fully idle — no more automatic work |
| `turn_start` | One LLM round-trip begins |
| `turn_end` | One LLM round-trip ends |
| `message_start` | New message appears |
| `message_update` | Assistant streaming delta |
| `tool_execution_start` | Tool execution pre-flight |
| `tool_execution_update` | Streaming tool output (×N) |
| `tool_execution_end` | Tool execution finalized |
| `model_select` | Model changed (/model, Ctrl+P, restore) |
| `thinking_level_select` | Thinking level changed |

**Key takeaway:** The most powerful interception points are hooks — they let you gate, transform, or redirect Pi's behavior at critical junctures. Events are timeline markers useful for logging, observability, and UI updates.

---

## Session Progress Checkpoint

This document captures the complete state of the "Pi Agent Inner Workings" investigation as of **2026-07-23**. If this conversation is resumed after a cutoff, reading this document will restore context. The investigation path so far:

1. ✅ **Extension discovery** — Confirmed which directories Pi auto-scans (`~/.pi/agent/extensions/` global + `<cwd>/.pi/extensions/` project-local). Proved `~/.pi/agent-frontend/extensions/` is invisible unless `PI_CODING_AGENT_DIR` targets it.

2. ✅ **Full event lifecycle** — All 28 documented events are registered in the tracer at `~/.pi/agent/extensions/dummy/index.ts`. Output goes to `/tmp/pi-event-trace.log`.

3. ✅ **Events vs. Hooks** — Categorized: 12 hooks (return values control behavior) vs. 16+ pure events (notification-only).

4. ✅ **Verified untested events** — 28 of 32 events confirmed. Remaining: `project_trust` (already trusted), `session_before_compact`/`session_compact` (need long session), `message_update` (silenced).

5. ✅ **Core agent loop** — `core-agent-loop/` — inner/outer loops, steering/follow-up queues, parallel vs sequential tool execution, stop conditions, context pipeline.

6. ✅ **Extension API** — `pi.registerTool()`, `pi.registerCommand()`, `ctx.ui.*`, `pi.appendEntry()` demonstrated and documented.

7. ✅ **AgentSession preflight** — Command expansion, input hooks, skill/template expansion, auth validation, compaction check, before_agent_start → agent loop.

8. ✅ **System prompt composition** — `system-prompt-composition/` — All 8 sections verified from live 13,165-char capture.

---

## Limitations & Future Work

1. **The tracer logs from a single extension.** If multiple extensions subscribe to the same events, handler order is extension-load-order, not captured by this trace.

2. **File-based logging adds I/O overhead.** Each event fires a synchronous `appendFileSync`. For production diagnostics, batch writes or use async I/O.

3. **No timing analysis.** The trace includes timestamps but no automatic duration calculation between events. Future: add elapsed-ms deltas between `turn_start`/`turn_end` and tool execution stages.

4. **`message_update` is silenced** to avoid log spam during streaming. Enable it if streaming tokens need tracing.

5. **RPC/print mode not tested.** The tracer was only verified in interactive (TUI) mode. Event availability in `--mode rpc` and `--mode json` may differ.

6. **11 events pending manual verification.** Session navigation, model/thinking, provider HTTP, and user_bash events are registered but haven't been triggered in a live session yet.
