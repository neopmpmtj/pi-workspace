# Pi Core Agent Loop — Walkthrough & Analysis

**Date:** 2026-07-24
**System:** Ubuntu 24.04 (Pi v0.81.1)
**Source:** `@earendil-works/pi-agent-core/dist/agent-loop.js` + `agent.js` (compiled JS in npm install)

---

## Overview

The core agent loop lives in `packages/agent/src/agent-loop.ts` (source) / `dist/agent-loop.js` (compiled). It is the engine that turns one user prompt into potentially multiple LLM calls with tool execution in between. The `Agent` class in `agent.ts` wraps it with state management, queueing, and lifecycle events.

The loop has **two nesting levels**:

```
OUTER LOOP — follow-up messages
  │
  └── INNER LOOP — tool calls + steering messages
        │
        ├── 1. Drain pending messages (steering or follow-up)
        ├── 2. Call LLM → stream assistant response
        ├── 3. Extract tool calls from response
        ├── 4. Execute tools (parallel or sequential)
        ├── 5. Check stop conditions
        └── 6. Poll for new steering messages → loop back
```

---

## The Two Queues

Pi has two message queues that inject messages at different points in the loop:

| Queue | User shortcut | Delivery point | Code |
|-------|--------------|----------------|------|
| **Steering** | `Enter` during run | Top of every inner-loop iteration — before the next LLM call | `getSteeringMessages()` polled after each turn |
| **Follow-up** | `Alt+Enter` during run | Only when the inner loop would exit — gives the agent one more outer-loop cycle | `getFollowUpMessages()` polled when `hasMoreToolCalls === false` |

The `Agent` class wraps both in `PendingMessageQueue` with two drain modes:

- `"one-at-a-time"` (default): drains one message per poll — agent responds, then gets next
- `"all"`: drains everything at once

### Pseudocode

```
OUTER:
  while true:
    hasMoreTools = true
    INNER:
      while hasMoreTools OR pendingMessages exist:
        inject pendingMessages into context
        assistant = callLLM(context)
        if assistant.error or aborted: STOP

        toolCalls = extractToolCalls(assistant)
        if toolCalls:
          results = executeTools(toolCalls)
          hasMoreTools = NOT all results.terminate
        else:
          hasMoreTools = false

        if shouldStopAfterTurn(): STOP
        pendingMessages = pollSteeringQueue()
      // inner loop exits

    followUp = pollFollowUpQueue()
    if followUp:
      pendingMessages = followUp   // re-enter inner loop
    else:
      break                         // truly done
```

---

## Tool Execution

### Execution Modes

```javascript
const hasSequentialToolCall = toolCalls.some(
  (tc) => context.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential"
);

if (config.toolExecution === "sequential" || hasSequentialToolCall) {
  return executeToolCallsSequential(...);  // one at a time, order preserved
}
return executeToolCallsParallel(...);       // preflight all, execute concurrently, collect
```

| Mode | When | Behavior |
|------|------|----------|
| **Parallel** (default) | No sequential tools in batch | Preflight all → execute concurrently → collect results in tool-call order |
| **Sequential** | `config.toolExecution === "sequential"` or any tool has `executionMode: "sequential"` | Execute one at a time, each waits for the previous |

A single sequential tool in a batch forces the **entire batch** to run sequentially.

### Tool Execution Lifecycle (6 stages, 2 hooks)

```
For each tool call:
  1. tool_execution_start          (event)
  2. prepareToolCall():
     - Find tool by name
     - Validate arguments
     - beforeToolCall()            (hook — can BLOCK)
  3. tool.execute()                (actual execution)
     - tool_execution_update ×N    (event — streaming partial results)
  4. afterToolCall()               (hook — can MODIFY result)
  5. tool_execution_end            (event)
  6. toolResult message            (event: message_start + message_end)
```

### Truncated Message Protection

If the LLM response hits the output token limit (`stopReason === "length"`), **all tool calls in that message are failed with an error** instead of being executed. The model receives:

```
"Tool call 'bash' was not executed: the response hit the output token limit, 
 so its arguments may be truncated. Re-issue the tool call with complete arguments."
```

This prevents executing tool calls with silently truncated arguments.

---

## Stop Conditions

The inner loop stops when `hasMoreToolCalls === false` AND `pendingMessages.length === 0`. Five conditions control this:

| Condition | Code | Effect |
|-----------|------|--------|
| No tools in response | `toolCalls.length === 0` | `hasMoreToolCalls = false` |
| LLM error/abort | `stopReason === "error" \|\| "aborted"` | Agent ends immediately — `agent_end` emitted |
| Token limit hit | `stopReason === "length"` | All tool calls failed with error; model must re-issue |
| All tools terminate | `every(result.terminate === true)` | `hasMoreToolCalls = false` — tools told the loop to stop |
| Graceful stop | `shouldStopAfterTurn()` returns `true` | Agent ends |

A tool can signal "stop" by returning `{ terminate: true }` in its result.

---

## Context Pipeline (every turn)

```
AgentMessage[]              (Pi's internal transcript)
  │
  ├─► transformContext()    [HOOK — extension can filter/mutate]
  │
  ├─► convertToLlm()        [AgentMessage[] → provider Message[]]
  │
  ├─► LLM request           (system prompt + messages + tools + options)
  │
  ├─► Response streamed     (message_start → message_update ×N → message_end)
  │
  ├─► Tool calls extracted  (if any)
  │
  ├─► Tools executed        (parallel or sequential)
  │
  ├─► prepareNextTurn()     [HOOK — can change model, thinking level, or context]
  │
  └─► Loop back
```

Key point: the **entire transcript** is re-sent on every LLM call. Pi is stateless at the model level — it doesn't rely on the provider remembering a previous request.

---

## `prepareNextTurn()` — Mid-Run Model Switching

```javascript
const nextTurnSnapshot = await config.prepareNextTurn?.(nextTurnContext);
if (nextTurnSnapshot) {
  currentContext = nextTurnSnapshot.context ?? currentContext;
  config = {
    ...config,
    model: nextTurnSnapshot.model ?? config.model,
    reasoning: nextTurnSnapshot.thinkingLevel === "off"
      ? undefined 
      : nextTurnSnapshot.thinkingLevel,
  };
}
```

An extension can change the **model or thinking level between turns within a single agent run**. This enables patterns like "use a cheap model for tool selection, switch to an expensive model for final synthesis."

---

## The `Agent` Class (`agent.js`)

The `Agent` class wraps the loop with:

| Concern | Mechanism |
|---------|-----------|
| **State** | `state.messages`, `state.tools`, `state.isStreaming`, `state.streamingMessage`, `state.pendingToolCalls`, `state.errorMessage` |
| **Run gating** | `activeRun` — prevents overlapping prompts; throws if you call `prompt()` during an active run |
| **Snapshot** | `createContextSnapshot()` — copies `messages` and `tools` arrays before each run |
| **Queueing** | `PendingMessageQueue` with `steer()`, `followUp()`, drain modes |
| **Abort** | `abort()` + `AbortController` shared via `signal` |
| **Listeners** | `subscribe()` — awaited in subscription order; `agent_end` isn't truly done until all listeners settle |

---

## Events Emitted by the Loop Itself

The loop directly emits these events (before the `Agent` class relays them to extensions):

| Event | Emitted when |
|-------|-------------|
| `agent_start` | Top of `runAgentLoop()` / `runAgentLoopContinue()` |
| `turn_start` | Start of each inner-loop iteration (except first turn of `runAgentLoop` which already emitted it) |
| `message_start` | New message appears (prompt, assistant partial, toolResult) |
| `message_update` | Streaming deltas from LLM |
| `message_end` | Message finalized |
| `tool_execution_start` | Before tool validation |
| `tool_execution_update` | Streaming partial results from tool |
| `tool_execution_end` | After tool finalization + `afterToolCall` |
| `turn_end` | End of each inner-loop iteration |
| `agent_end` | Agent run finished (all messages produced) |

The `Agent.processEvents()` method then routes these to subscribed listeners (extensions, SDK consumers).

---

## Experiment: Observe the Loop

To see the loop structure in the trace:

1. Send: *"Read /home/pmpmt/.pi/agent/extensions/dummy/index.ts and tell me how many lines it has"*
2. Check `/tmp/pi-event-trace-*.log`

Expected trace:
```
turn #0:
  message: user
  context
  ▶ LLM responds with read tool call
  tool_execution_start → tool_call → tool_execution_update → tool_result → tool_execution_end
  message: toolResult
  turn_end (tools: read)

turn #1:
  context (includes toolResult)
  ▶ LLM formats the answer
  message: assistant
  turn_end (tools: none)

agent_end
agent_settled
```

To see the outer (follow-up) loop: send a prompt, then press `Alt+Enter` mid-run with a follow-up message. The agent finishes its current run, polls the follow-up queue, and starts a new run from the follow-up message.

---

## Session Progress Checkpoint

This document captures the **core agent loop** analysis — the second major stage in understanding Pi's internals.

**Investigation path so far:**

1. ✅ **Extension discovery** — `extension-discovery-and-event-lifecycle/`
2. ✅ **Full event lifecycle** — 28 of 32 events verified
3. ✅ **Core agent loop** — this document
4. ⬜ **Next: Extension API** — `pi.registerTool()`, `pi.registerCommand()`, `pi.registerProvider()`, `ctx.ui.*`, custom UI components
5. ⬜ **Next: AgentSession** — how prompts are preflighted, how sessions persist, how compaction and retry work
6. ⬜ **Next: System prompt composition** — `system-prompt.ts`, how AGENTS.md, skills, and tool descriptions are assembled
