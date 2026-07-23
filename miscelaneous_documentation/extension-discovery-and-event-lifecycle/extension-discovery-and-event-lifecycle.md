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

**Finding:** Pi uses exactly **ONE global config directory** (`~/.pi/agent/`, overridable via `PI_CODING_AGENT_DIR`). It does not recursively scan for sibling `agent-*` directories. The `agent-frontend/` directory — despite having the same internal structure (its own `extensions/`, `skills/`, `settings.json`, `sessions/`) — is invisible unless explicitly targeted with the env var.

**Finding:** Project-local discovery is `<cwd>/.pi/extensions/`. When cwd is `~/.pi/`, this resolves to `~/.pi/.pi/extensions/`. This is not a dual `.pi` convention — it's simply `<cwd>` + `.pi/extensions/`.

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

### 6. Extension Discovery Is Exact, Not Recursive

| Directory | Loaded? | Mechanism |
|-----------|---------|-----------|
| `~/.pi/agent/extensions/` | ✅ Always | Global config dir (`PI_CODING_AGENT_DIR`, defaults to `~/.pi/agent/`) |
| `<cwd>/.pi/extensions/` | ✅ If exists | Project-local discovery |
| `~/.pi/agent-frontend/extensions/` | ❌ Never | Only loaded if `PI_CODING_AGENT_DIR=~/.pi/agent-frontend` |

Pi does not scan for sibling `agent-*` directories or recursively discover `index.ts` files. There is exactly one global config directory.

---

## Event Registration Reference

The tracer registers handlers for every documented lifecycle event. This is the complete event subscription surface used:

```
Startup:     project_trust → session_start → resources_discover
Input:       input (before skill/template expansion)
Agent:       before_agent_start → agent_start → agent_end → agent_settled
Turn:        turn_start → context (×N) → turn_end
Message:     message_start → message_update → message_end
Tool:        tool_execution_start → tool_call → tool_execution_update (×N)
             → tool_result → tool_execution_end
Session:     session_shutdown
```

All events are documented in `~/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`.

---

## Files Created/Modified

| File | Lines | Purpose |
|------|-------|---------|
| `~/.pi/agent/extensions/dummy/index.ts` | 110 | Full lifecycle tracer (file-based logging to `/tmp/pi-event-trace.log`) |
| `~/.pi/agent-frontend/extensions/agent-frontend-dummy/index.ts` | 16 | Control extension — proved NOT auto-loaded |
| `~/.pi/.pi/extensions/project-dummy/index.ts.disabled` | 17 | Control extension — proved project-local loading, now disabled |
| `/tmp/pi-event-trace.log` | — | Trace output (cleared on each startup) |
| **Total** | **143** | |

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

## Limitations & Future Work

1. **The tracer logs from a single extension.** If multiple extensions subscribe to the same events, handler order is extension-load-order, not captured by this trace.

2. **File-based logging adds I/O overhead.** Each event fires a synchronous `appendFileSync`. For production diagnostics, batch writes or use async I/O.

3. **No timing analysis.** The trace includes timestamps but no automatic duration calculation between events. Future: add elapsed-ms deltas between `turn_start`/`turn_end` and tool execution stages.

4. **`message_update` is silenced** to avoid log spam during streaming. Enable it if streaming tokens need tracing.

5. **RPC/print mode not tested.** The tracer was only verified in interactive (TUI) mode. Event availability in `--mode rpc` and `--mode json` may differ.
