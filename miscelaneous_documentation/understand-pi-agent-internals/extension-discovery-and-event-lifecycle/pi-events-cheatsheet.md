# Pi Events & Hooks — Quick Reference

> Tracer: `~/.pi/.pi/extensions/pi-event-tracer/index.ts` → output at `/tmp/pi-event-trace-<timestamp>.log`
> System prompt capture: `/tmp/pi-system-prompt.txt` (updated on every prompt)
> **Total: 12 hooks + 20 events = 32**

Verification key: ✅ verified | ⬜ untested | 🔇 silenced in tracer

---

## At a Glance

| Type | Count | Return value | Purpose |
|------|-------|-------------|---------|
| **Hook** | 12 | ✅ Controls behavior | Block, transform, cancel, inject, modify |
| **Event** | 20 | ❌ Ignored | Timeline markers — logging, UI updates, observability |

---

## HOOKS — Return Values Control Behavior

Hooks intercept Pi at decision points. Return `undefined` to pass through unchanged. Return a value to block, transform, or redirect.

### Input (1)

| Hook | Triggers | Return shape |
|------|----------|-------------|
| `input` ✅ | User submits text, before skill/template expansion | `{ action: "handled" }` — stop, LLM never called<br>`{ action: "transform", text, images? }` — rewrite input<br>`{ action: "continue" }` — default |

### Agent (1)

| Hook | Triggers | Return shape |
|------|----------|-------------|
| `before_agent_start` ✅ | Prompt accepted, before loop runs | `{ message? }` — inject a persistent message into context<br>`{ systemPrompt? }` — replace system prompt for this turn |

### Messages (1)

| Hook | Triggers | Return shape |
|------|----------|-------------|
| `message_end` ✅ | Any message finalized (user, assistant, toolResult) | `{ message }` — replace the message (must keep same `role`) |

### Tools (2)

| Hook | Triggers | Return shape |
|------|----------|-------------|
| `tool_call` ✅ | After validation, before tool executes | `{ block: true, reason? }` — stop tool. Model sees reason as error |
| `tool_result` ✅ | After tool finishes, before result emitted | `{ content?, details?, isError?, usage? }` — patch any field |

### Context (1)

| Hook | Triggers | Return shape |
|------|----------|-------------|
| `context` ✅ | Before each LLM call, with full message array | `{ messages }` — filtered/replaced message array |

### Provider HTTP (1)

| Hook | Triggers | Return shape |
|------|----------|-------------|
| `before_provider_headers` ✅ | HTTP headers assembled | Mutate `event.headers` in place — set to `null` to delete a header |

### User Bash (1)

| Hook | Triggers | Return shape |
|------|----------|-------------|
| `user_bash` ✅ | `!command` or `!!command` in editor | `{ operations? }` — custom BashOperations (SSH, wrapper)<br>`{ result? }` — skip execution, return this result directly |

### Session Navigation (4)

| Hook | Triggers | Return shape |
|------|----------|-------------|
| `session_before_switch` ✅ | `/new` or `/resume` | `{ cancel: true }` — abort the switch |
| `session_before_fork` ✅ | `/fork` or `/clone` | `{ cancel: true }` — abort the fork/clone |
| `session_before_compact` ⬜ | Manual or auto compaction | `{ cancel: true }` — abort compaction<br>`{ compaction: { summary, firstKeptEntryId, tokensBefore } }` — provide custom summary |
| `session_before_tree` ✅ | `/tree` navigation | `{ cancel: true }` — abort navigation<br>`{ summary: { summary, details? } }` — provide custom summary |

---

## EVENTS — Pure Notification, Return Values Ignored

Events are timeline markers. Subscribe to observe. Return values are discarded.

### Startup (3)

| Event | Fires when |
|-------|-----------|
| `project_trust` ⬜ | Project trust decision needed (before project resources load) |
| `session_start` ✅ | Session created, loaded, reloaded, or switched |
| `resources_discover` ✅ | After `session_start` — contribute extra skill/prompt/theme paths |

### Agent Run (3)

| Event | Fires when |
|-------|-----------|
| `agent_start` ✅ | Agent run begins |
| `agent_end` ✅ | Run ends — retry, compaction, or follow-up may still follow |
| `agent_settled` ✅ | **Fully idle** — no more automatic work. Use this for status integrations |

### Turns (2)

| Event | Fires when |
|-------|-----------|
| `turn_start` ✅ | One LLM request + response begins |
| `turn_end` ✅ | One LLM request + response + tool batch completes |

### Messages (2)

| Event | Fires when |
|-------|-----------|
| `message_start` ✅ | New message appears (user, assistant, toolResult) |
| `message_update` 🔇 | Assistant streaming — token-by-token deltas. Silenced in tracer |

### Tools (3)

| Event | Fires when |
|-------|-----------|
| `tool_execution_start` ✅ | Pre-flight (before `tool_call` hook) |
| `tool_execution_update` ✅ | Streaming tool output — fires multiple times per tool |
| `tool_execution_end` ✅ | Execution finalized (after `tool_result` hook) |

### Session Lifecycle (4)

| Event | Fires when |
|-------|-----------|
| `session_info_changed` ✅ | Session renamed (`/name` or `pi.setSessionName()`) |
| `session_compact` ⬜ | Compaction entry written (needs long session to trigger) |
| `session_tree` ✅ | Tree navigation complete |
| `session_shutdown` ✅ | Runtime torn down (quit, reload, new, resume, fork) |

### Model & Thinking (2)

| Event | Fires when |
|-------|-----------|
| `model_select` ✅ | Model changed (`/model`, Ctrl+P, session restore) |
| `thinking_level_select` ✅ | Thinking level changed (keybinding, settings, model change) |

### Provider (1)

| Event | Fires when |
|-------|-----------|
| `after_provider_response` ✅ | HTTP response received, before stream consumed |

---

## Flow Order

```
STARTUP
  project_trust
  session_start
  resources_discover
      ↓ idle
PROMPT
  input                   [HOOK]
  before_agent_start      [HOOK]
  agent_start
    ┌ turn_start ──────────────────────────┐
    │ message_start/end (user)             │
    │ context                 [HOOK]       │
    │ before_provider_headers [HOOK]       │
    │ ▶ LLM request                        │
    │ after_provider_response              │
    │ message_start/update/end (assistant) │
    │                                      │
    │ (if tools:)                          │
    │   tool_execution_start               │
    │   tool_call              [HOOK]      │
    │   tool_execution_update ×N           │
    │   tool_result            [HOOK]      │
    │   tool_execution_end                 │
    │   message_start/end (toolResult)     │
    │                                      │
    │ ▶ loop back if more tools            │
    └──────────────────────────────────────┘
  agent_end
  agent_settled
      ↓ idle
```

---

## Anti-Pitfalls

- **`agent_settled` is the true "done" signal.** `agent_end` may be followed by retry or compaction.
- **`console.log` is unreliable in TUI mode.** Use file I/O for traces.
- **Hooks chain.** Multiple handlers run in extension load order. Each sees the previous handler's changes.
- **`tool_call` input is mutable.** Mutate `event.input` in place to patch arguments. No re-validation.
- **Extensions load: files first, then subdirectories** — within each discovery tier.
- **`-e` loads first,** before all auto-discovered extensions. One session only.
