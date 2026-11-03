# 02 — Event lifecycle

- **Date:** 2026-11-03
- **Host:** dev laptop `pmpmt`, Node `v24.21.0`, pi `1.4.0`
- **Agent home:** `~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent` · **cwd:** `/home/pmpmt/.pi`
- **Sources (local):**
  - `.../@earendil-works/pi-coding-agent/docs/extensions.md` ("Understand the runtime lifecycle", "Events and concurrency", "Choose an event by intent")
  - `.../dist/core/extensions/types.d.ts` (event payloads + result types; 1756 lines)
  - `.../dist/core/extensions/runner.js` (all dispatch logic; 1237 lines)
  - `.../dist/core/agent-session.js` (agent event → extension event bridge)
  - `.../dist/core/sdk.js`, `.../dist/modes/interactive/interactive-mode.js` (provider hooks, `user_bash`)
  - `.../node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js` (source of `agent_*` / `turn_*` / `message_*`)
  - **Live evidence:** `/tmp/pi-event-trace-2026-11-03T07-33-56.log` — a real trace of *this* session, produced by the project extension `.pi/extensions/pi-event-tracer/index.ts`

---

## 1. Reality check on the counts

The old note says "32 events (12 hooks, 20 events)". In 1.4.0:

- `types.d.ts` declares **41** `on(event: …)` overloads (line ~1130-1180).
- The `ExtensionEvent` union at `types.d.ts:1081` has **32** members — that union bundles
  the `session_*` family into one `SessionEvent`, so 32 ≠ the number you can subscribe to.

**Use 41.** Subscribe-able names, in the order the type declares them:

```
project_trust, resources_discover, session_start, session_info_changed,
session_before_switch, session_before_fork, session_before_compact, session_compact,
session_compact_failed, session_shutdown, mcp_servers_change, session_before_tree,
session_tree, context, context_with_system, cache_warming_decision,
before_provider_request, before_provider_headers, after_provider_response,
provider_stream_event, before_agent_start, agent_start, agent_end,
agent_before_settle, agent_settled, ui_prompt_start, ui_prompt_end, turn_start,
turn_end, message_start, message_update, message_end, tool_execution_start,
tool_execution_update, tool_execution_end, model_select, thinking_level_select,
tool_call, tool_result, user_bash, input
```

`pi.on()` returns an unsubscribe function. `snapshotEventHandlers()`
(`runner.js:87`) copies each extension's handler array at dispatch start, so subscribing
during a dispatch does not affect the dispatch in progress.

---

## 2. Hook vs. notification is a property of the *result type*

Do not memorize a list — read the handler's second type parameter in `types.d.ts`.
`ExtensionHandler<E, R = undefined>` (`types.d.ts:1244`) defaults `R` to `undefined`, and
that is exactly the notification-only case.

| Class | How you recognize it | What happens to the return value |
|---|---|---|
| Notification | `ExtensionHandler<X>` (no `R`) | discarded; `emit()` also ignores non-`session_before_*` results (`runner.js:813-840`) |
| In-place mutation | `R` is void, but the payload is mutable | `before_provider_headers.headers` mutated directly (`runner.js:1095`) |
| Chained transform | `R` replaces the value for the next handler | `input`, `context`, `context_with_system`, `message_end`, `tool_result`, `before_provider_request` |
| Gate | `R` aborts the operation | `tool_call.block`, `input.action === "handled"`, `session_before_*.cancel`, `user_bash` returning a result |
| Boundary | `emitBoundary()` | `turn_end`, `agent_before_settle` — each handler sees the entries/`continue` proposed so far |
| Last override | `cache_warming_decision` | last handler returning `{action}` wins (`runner.js:842`) |

Hook-capable events in 1.4.0: `project_trust`, `resources_discover`, `session_before_switch`,
`session_before_fork`, `session_before_compact`, `session_before_tree`, `context`,
`context_with_system`, `cache_warming_decision`, `before_provider_request`,
`before_provider_headers`, `before_agent_start`, `turn_end`, `agent_before_settle`,
`message_end`, `tool_call`, `tool_result`, `user_bash`, `input` — **19**.
Everything else is observation-only (22).

---

## 3. Where dispatch lives

`runner.js` has one `emit` per *shape* of composition, not one per event name:

| Runner method | Line | Used by |
|---|---|---|
| `emitProjectTrustEvent` (module fn) | 107 | `project_trust` |
| `emitBoundary` | 759 | `turn_end`, `agent_before_settle` |
| `emit` | 813 | every notification event + `session_before_*` (only those keep the result) |
| `emitCacheWarmingDecision` | 842 | last-override semantics |
| `emitMessageEnd` | 864 | `message_end` |
| `emitToolResult` | 900 | `tool_result` |
| `emitToolCall` | 957 | `tool_call` (stops at first `block`) |
| `emitUserBash` | 973 | `user_bash` (first non-`undefined` wins; a handler *throw* rethrows and blocks the command) |
| `emitContext` | 1006 | `context` then `context_with_system`, in one pass |
| `emitBeforeProviderRequest` | 1066 | payload chaining |
| `emitBeforeProviderHeaders` | 1095 | mutation in place |
| `emitBeforeAgentStart` | 1121 | collects `message`s, applies `systemPrompt` override |
| `emitResourcesDiscover` | 1165 | resource discovery |
| `emitInput` | 1201 | `input` chaining / `handled` gate |

Universal rules in every one of these loops:

- Handlers run in **extension load order**, then registration order (the order established by
  doc 01).
- A handler **throw** is caught and reported via `emitError` — except `user_bash`, which
  deliberately rethrows (fail closed). Dispatch continues to the next handler.
- `hasHandlers(name)` is checked before several dispatches (`turn_end`, `agent_before_settle`,
  `input`, `session_shutdown`) so a missing subscription costs nothing.

---

## 4. Run lifecycle, with the real trace

`pi-agent-core/dist/agent-loop.js` emits the low-level events; `agent-session.js`
`_emitExtensionEvent()` (line 892) translates each into the extension event. Translation
table: `agent_start` 901, `agent_end` 904, `turn_start` 908, `turn_end` 913 (→ boundary),
`message_start` 922, `message_update` 926, `message_end` 937, `tool_execution_start` 956,
`tool_execution_update` 964, `tool_execution_end` 976.

Observed in this session (trace file above, trimmed to one run, subagent turn 0):

```
input — text: "/explore-pi …" | source: interactive | streamingBehavior: idle
before_agent_start — prompt: "You are a Pi Agent Harness tutor. …"
  (SYSTEM PROMPT: 19616 chars)
agent_start
turn_start — turn #0
message_start/end — role: system            (empty content; the prompt is a system message)
message_start/end — role: user
message_start/end — role: custom   ×4       ← the 4 input-contains-* hidden injections
context — messages: 5
before_provider_headers — keys: (none)
after_provider_response — status: 200
message_start — role: assistant
message_end — role: assistant
tool_execution_start — bash               ← call A starts
tool_call            — bash | call_00_    ← hook A
tool_execution_start — bash               ← call B starts (parallel!)
tool_call            — bash | call_01_    ← hook B
tool_execution_update ×N  (A and B interleaved)
tool_result A → tool_execution_end A
tool_result B → tool_execution_end B
message_start/end — role: toolResult ×2
turn_end — turn #0 | tools: bash, bash
turn_start — turn #1   (context now sees 8 messages)
… repeat …
agent_end — messages in run: 86
agent_settled — agent fully idle, no more retries/compaction/follow-up
```

Two facts this nails down:

1. **Parallel tool calls interleave.** `tool_execution_start` for call B fires before call A
   finishes. Never assume a sibling call or its result exists inside a tool event.
2. **One user prompt = one run = many turns.** 86 messages accumulated over 17 turns in a
   single run, ending in exactly one `agent_end` + one `agent_settled`.

`agent_end` is **not** a final-idle signal: retries, error recovery, compaction retry, and
queued messages start another run after it. `agent_settled` is the idle signal
(`agent-session.js:689`).

---

## 5. Turn boundary: `turn_end`

`turn_end` is not a plain notification. `_dispatchTurnEndBoundary()` (`agent-session.js:485`)
runs after the turn's tool results are persisted, and gives handlers:

- `message` (the final assistant message), `toolResults`, `messageEntryId`,
  `toolResultEntryIds`, `turnIndex`, `outcome` (`"completed" | "aborted" | "error"`)
- `entries` — the custom/custom_message/context_edit/compaction entries proposed so far
- `continue` — the continuation flag so far
- `context` — rebuilt after every handler from those entries

Returning `{ continue: true }` buys **one more model request** in the same run. The result is
plumbed through `agent.finishTurn` (`_installAgentBoundaryHooks`, line 527): the extension
decision is OR'd with the loop's own decision, and `{action:"end"}` from the core loop always
wins. `_buildBoundaryContext([], …).canContinue` guards against continuing an empty/invalid
context — a rejected continuation is reported, not silently ignored.

`agent_before_settle` (`agent-session.js:1560-1590`) is the last place to append entries or ask
for one continuation before `agent_settled`. Unconditional continuation here is an infinite
loop; always guard.

---

## 6. Model-request pipeline

The order the docs give, and where each is dispatched:

| Step | Event | Runner | Coding-agent call site |
|---|---|---|---|
| 1 | `context` | `emitContext` 1006 | `sdk.js:281` |
| 2 | `context_with_system` | `emitContext` (second loop) | `sdk.js:281` |
| 3 | `before_provider_headers` | `emitBeforeProviderHeaders` 1095 | `sdk.js:207` |
| 4 | `before_provider_request` | `emitBeforeProviderRequest` 1066 | `sdk.js:228` |
| 5 | `after_provider_response` | `emit` | `sdk.js:234` |
| 6 | `provider_stream_event` | `emit` (per parsed stream event) | `sdk.js:244` |

Details that bite:

- `context` handlers **never see system messages**. Pi strips them, hands you the conversation,
  then re-attaches: unchanged conversation → every system message restored in place (cache
  prefix preserved); changed conversation → the whole prompt becomes one leading system message
  (`restoreSystemMessages`, `runner.js:101`). That is why a sloppy `context` transform costs
  you prompt-cache hits.
- `context_with_system` sees everything. Pi warns (does not block) if you move the leading
  system message off index 0, because providers take the prompt and initial tool declarations
  from there.
- These two are **request-time only**; the transcript on disk is untouched.
- `before_provider_request` returns a replacement payload (`unknown`), so it is the place to
  edit serialized bodies. `before_provider_headers` is mutation-only.
- `provider_stream_event` is notification-only, not persisted, awaited in stream order — a
  slow handler throttles the stream.

---

## 7. Tool execution stages

Per tool call, in order: `tool_execution_start` → `tool_call` → `tool_execution_update`* →
`tool_result` → `tool_execution_end`.

- `tool_call` (`emitToolCall`, 957) can mutate `event.input` in place or return
  `{block: true, reason}`, which stops the call and skips the rest of the handlers. `terminate:
  true` is a *hint*, honoured only if every finalized result in the batch sets it.
- `tool_result` (`emitToolResult`, 900) composes: each handler's `content` / `details` /
  `structuredContent` / `isError` / `usage` overrides flow to the next.
- Nested calls (`ctx.executeTool`) emit the same three `tool_execution_*` events plus
  `tool_call` / `tool_result`, with `parentToolCallId` set and ids shaped `<parent>/<n>`
  (`core/nested-tool-calls.js:112`).
- Tool hooks run **per call**, and calls in one assistant message can run in parallel.

---

## 8. Session lifecycle (separate from the run lifecycle)

```
process startup → project_trust (only if project resources exist)
                → session_start (reason: "startup")
                → resources_discover (reason: "startup")

/new, /resume  → session_before_switch → session_shutdown → session_start (reason "new"|"resume")
/fork, /clone  → session_before_fork   → session_shutdown → session_start (reason "fork")
/reload        → session_shutdown      → new runtime     → session_start (reason "reload")
exit           → session_shutdown      → process ends
```

Reasons come from `agent-session-runtime.js` (lines 141, 165, 211, 229, 246, 291) and
`agent-session.js:3028` (`"reload"`). Also in this family: `session_info_changed` (name/label),
`session_before_compact` / `session_compact` / `session_compact_failed`,
`session_before_tree` / `session_tree`, `mcp_servers_change`.

`session_before_*` handlers return `{cancel: true}` to veto, and dispatch **stops at the first
cancelling handler** (`runner.js:820-828`). `session_before_compact` can also supply a
`compaction` result; `session_before_tree` can supply a branch `summary`.

After `await ctx.reload()` your code is running in the **old** runtime; session-bound state from
it must not be reused.

---

## 9. What fires in *this* home

Real handler inventory (`grep -n 'pi.on('`), project extensions first (load order):

| Extension | Events |
|---|---|
| `.pi/extensions/pi-event-tracer` (project) | 28: project_trust, session_start, resources_discover, input, before_agent_start, agent_start, agent_end, agent_settled, turn_start, turn_end, message_start/update/end, tool_execution_start/update/end, tool_call, tool_result, context, before_provider_headers, after_provider_response, session_info_changed, session_before_switch/fork/compact, session_compact, session_before_tree, session_tree, session_shutdown, model_select, thinking_level_select, user_bash |
| `.pi/extensions/session-memory` (project) | session_before_switch, session_before_fork, session_shutdown |
| `extensions/input-contains-{email,path,url}`, `less-than-input-words` (user) | `input` (per-turn display) + `before_agent_start` → `{message:{customType, content, display:false}}` — the hidden labeled blocks in the prompt |
| `extensions/pi-prompt-capture.ts` (user) | `before_agent_start` (saves the rendered system prompt), `before_provider_request` |
| `extensions/secret-scrubber.ts` (user) | `tool_result` → redacts secrets, logs to `events.log` |
| `extensions/cron.ts` (user) | `session_start` (notify active jobs), **`session_end`** |
| `extensions/auto-sync.ts` (user) | `session_shutdown` |
| `extensions/chat/index.ts` (user) | `session_start`, `session_shutdown` |

**Found a live bug:** `cron.ts:731` registers `pi.on("session_end", …)` to clear its timer.
There is no `session_end` event in 1.4.0 (`grep session_end` on `types.d.ts` and `runner.js`
returns nothing), so that handler can never fire. jiti does not type-check, so it loads
silently and the cleanup is dead code. The correct name is `session_shutdown`.

---

## 10. Try it

```bash
# This session's trace, already being written:
ls -t /tmp/pi-event-trace-*.log | head -1
tail -40 "$(ls -t /tmp/pi-event-trace-*.log | head -1)"
```

Inside pi:

1. **Watch a gate.** Drop this into `~/.pi/…/extensions/deny-rm.ts`, `/reload`, ask for a
   `rm -rf` and observe the block (and that later handlers never run):

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default (pi: ExtensionAPI) => {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && /\brm\s+-rf\b/.test(String(event.input.command ?? ""))) {
      await ctx.ui.notify("blocked rm -rf", "warn");
      return { block: true, reason: "destructive command" };
    }
  });
};
```

2. **Watch a transform chain.** Register `context` in two extensions, each logging
   `event.messages.length`; the second sees what the first returned.
3. **Watch the boundary.** Register `turn_end` and return `{ continue: true }` once (guard on a
   flag) — you get exactly one extra model request before `agent_end`.
4. **Prove `session_shutdown` fires on `/reload`** (and that `session_end` never does).

---

## Next

**03 — Core agent loop.** `pi-agent-core/dist/agent-loop.js`: the inner loop (tool calls +
steering messages) vs the outer loop (follow-ups), where `agent_end` is emitted (lines 55-212),
how many turns that produces, parallel vs sequential tool batches, the stop conditions
(`error`, abort, token limit, `terminate`, `shouldStopAfterTurn`), and the
`transformContext → convertToLlm → provider request` pipeline that the `context` event plugs
into.
