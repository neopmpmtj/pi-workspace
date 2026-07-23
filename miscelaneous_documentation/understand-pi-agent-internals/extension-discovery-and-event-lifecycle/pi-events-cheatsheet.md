# Pi Events & Hooks — Quick Reference

> Portable cheatsheet. Read this alongside the full investigation at `extension-discovery-and-event-lifecycle.md`.
> Tracer lives at `~/.pi/agent/extensions/dummy/index.ts` — output at `/tmp/pi-event-trace.log`.

---

## HOOKS (12) — Return values control behavior

Hooks let you intercept, transform, block, or redirect Pi's behavior. Return `undefined` to pass through unchanged.

### Input

| Hook | Fires when | Can… |
|------|-----------|------|
| `input` | User submits text (before skill/template expansion) | Handle entirely, transform text, or let it pass |

### Agent

| Hook | Fires when | Can… |
|------|-----------|------|
| `before_agent_start` | Prompt accepted, before agent loop runs | Inject a persistent message, modify the system prompt |

### Messages

| Hook | Fires when | Can… |
|------|-----------|------|
| `message_end` | Any message finalized (user, assistant, toolResult) | Replace the message (must keep same `role`) |

### Tools

| Hook | Fires when | Can… |
|------|-----------|------|
| `tool_call` | After validation, before tool executes | Block execution (`{ block: true, reason? }`) |
| `tool_result` | After tool finishes, before result message emitted | Modify content, details, isError, or usage |

### Context

| Hook | Fires when | Can… |
|------|-----------|------|
| `context` | Before each LLM request, with full message history | Filter or mutate the messages array |

### Provider HTTP

| Hook | Fires when | Can… |
|------|-----------|------|
| `before_provider_headers` | HTTP headers assembled, before request sent | Add, override, or delete headers (mutate `event.headers` in place) |

### User Bash

| Hook | Fires when | Can… |
|------|-----------|------|
| `user_bash` | User runs `!command` or `!!command` in editor | Replace execution entirely or wrap the built-in backend |

### Session Navigation

| Hook | Fires when | Can… |
|------|-----------|------|
| `session_before_switch` | `/new` or `/resume` | Cancel the switch |
| `session_before_fork` | `/fork` or `/clone` | Cancel the fork/clone |
| `session_before_compact` | Manual or auto compaction triggered | Cancel compaction, or provide a custom summary |
| `session_before_tree` | `/tree` navigation | Cancel navigation, or provide a custom summary |

---

## EVENTS (16) — Pure notification, return values ignored

Events are timeline markers. Use them for logging, observability, status updates, and UI changes.

### Startup

| Event | Fires when |
|-------|-----------|
| `project_trust` | Project trust decision needed (before project resources load) |
| `session_start` | Session created, loaded, reloaded, or switched |
| `resources_discover` | After `session_start` — extensions can contribute extra skill/prompt/theme paths |

### Agent Run

| Event | Fires when |
|-------|-----------|
| `agent_start` | Agent run begins (one prompt) |
| `agent_end` | Agent run ends — retry, compaction, or follow-up may still follow |
| `agent_settled` | Fully idle — no retries, compaction, or queued continuations remain |

### Turns

| Event | Fires when |
|-------|-----------|
| `turn_start` | One LLM request + response cycle begins |
| `turn_end` | One LLM request + response + tool batch completes |

### Messages

| Event | Fires when |
|-------|-----------|
| `message_start` | A new message appears (user, assistant, or toolResult) |
| `message_update` | Assistant streaming — token-by-token deltas (`text_delta`, `thinking_delta`) |

### Tools

| Event | Fires when |
|-------|-----------|
| `tool_execution_start` | Tool execution pre-flight (before `tool_call`) |
| `tool_execution_update` | Streaming tool output — can fire multiple times per tool |
| `tool_execution_end` | Tool execution finalized (after `tool_result`) |

### Session Lifecycle

| Event | Fires when |
|-------|-----------|
| `session_info_changed` | Session renamed via `/name` or `pi.setSessionName()` |
| `session_compact` | Compaction entry written to session |
| `session_tree` | Tree navigation complete |
| `session_shutdown` | Session runtime torn down (quit, reload, new, resume, fork) |

### Model & Thinking

| Event | Fires when |
|-------|-----------|
| `model_select` | Model changed via `/model`, Ctrl+P, or session restore |
| `thinking_level_select` | Thinking level changed via keybinding, settings, or model change |

### Provider

| Event | Fires when |
|-------|-----------|
| `after_provider_response` | HTTP response received, before stream body consumed |

---

## Flow Order (typical interactive session)

```
STARTUP
  project_trust
  session_start
  resources_discover
      │
      ▼ (idle — waiting for input)
      │
PROMPT
  input                   [HOOK]
  before_agent_start      [HOOK]
  agent_start
      │
      ┌─ turn_start ──────────────────────────┐
      │  message_start (user)                 │
      │  message_end   (user)                 │
      │  context                 [HOOK]       │
      │  before_provider_headers [HOOK]       │
      │  ▶ LLM request                        │
      │  after_provider_response              │
      │  message_start (assistant)            │
      │  message_update (assistant) ×N        │
      │  message_end   (assistant)  [HOOK]    │
      │                                       │
      │  (if tools called:)                   │
      │  tool_execution_start                 │
      │  tool_call                [HOOK]      │
      │  tool_execution_update ×N             │
      │  tool_result              [HOOK]      │
      │  tool_execution_end                   │
      │  message_start (toolResult)           │
      │  message_end   (toolResult) [HOOK]    │
      │                                       │
      │  ▶ loop back to turn_start if more    │
      └───────────────────────────────────────┘
      │
  agent_end
  agent_settled
      │
      ▼ (idle)
```

---

## Anti-Pitfalls

- **Use `agent_settled`, not `agent_end`**, for status integrations. `agent_end` may be followed by auto-retry or compaction.
- **`console.log` is unreliable in TUI mode.** The TUI owns stdout. Use file-based logging (`appendFileSync`) for traces.
- **Hooks chain.** Multiple extensions can subscribe to the same hook — they run in extension load order, each seeing the previous handler's modifications.
- **`tool_call` sees `event.input` as mutable.** Mutate it in place to patch arguments. No re-validation occurs after your mutation.
- **`message_update` is high-frequency** during streaming. Don't do heavy work here.
