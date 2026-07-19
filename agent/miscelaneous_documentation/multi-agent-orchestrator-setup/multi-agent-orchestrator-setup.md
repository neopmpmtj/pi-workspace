# Pi Multi-Agent Orchestrator — Setup & Implementation Report

**Date:** 2026-07-19
**System:** Ubuntu 24.04 (Pi v0.80.x)
**Location:** `~/.pi/agent/` (orchestrator) + `~/.pi/agent-frontend/` (specialist)

---

## Problem

Pi is a single-agent system by default — one LLM, one session, one context window. For larger projects, this creates bottlenecks:

- A single agent context-switches between roles (planning, coding, reviewing), losing focus
- There's no way to parallelize independent work (e.g., analyzing two separate modules simultaneously)
- The agent burns tokens on orientation tasks before it can start real work
- No built-in mechanism for one agent to delegate to another and receive results

The goal: a multi-agent architecture where an **orchestrator** delegates work to **specialist agents** with their own workspaces, configurations, and instructions — all running as child processes managed by a pool, with results automatically routed back.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Orchestrator Agent (~/.pi/agent/)                              │
│  AGENTS.md: "You are the Orchestrator. Delegate — do NOT       │
│             execute tasks yourself."                            │
│                                                                 │
│  Tools: spawn_agent, send_input, wait_agent, close_agent,     │
│         resume_agent                     │                      │
│                                          │                      │
│  ┌───────────────────────────────────────┼───────────────────┐  │
│  │  pi-agents-pool (extension)           ▼                   │  │
│  │  AgentPool class                                          │  │
│  │    │                                                      │  │
│  │    ├─ spawn("pi", "--mode", "rpc", "--session", …)      │  │
│  │    ├─ stdout JSON-line reader                             │  │
│  │    ├─ RPC request/response correlation                    │  │
│  │    ├─ Status tracking + TUI widget                        │  │
│  │    └─ Auto-notification on agent completion               │  │
│  └───────────────────────────────────────┬───────────────────┘  │
│                                          │                      │
└──────────────────────────────────────────┼──────────────────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │                      ▼                      │
                    │  Front-End Specialist (~/.pi/agent-frontend/)│
                    │  AGENTS.md: "You are the Front-End          │
                    │             Specialist."                     │
                    │  APPEND_SYSTEM.md: reporting protocol        │
                    │  settings.json: independent model config     │
                    │  sessions/: isolated session history         │
                    └─────────────────────────────────────────────┘
```

---

## Phase 1 — Specialist Agent Workspaces

### Concept

Each specialist agent gets its own **workspace directory** under `~/.pi/`, containing:

- **`AGENTS.md`** — role-defining system prompt loaded at session start
- **`APPEND_SYSTEM.md`** — additional instructions appended to the system message
- **`settings.json`** — independent configuration (model, theme, etc.)
- **`sessions/`** — isolated session history (separate from the orchestrator)
- **`bin/`** — optional bundled tools (fd, rg)

The workspace directory **is** the agent's working directory when spawned — `cwd` is set to `process.cwd()` (the orchestrator's cwd), but the session file and all context separation happens via the RPC layer.

### Front-End Specialist (`~/.pi/agent-frontend/`)

#### AGENTS.md

Defines the agent's identity and scope:

```markdown
# Front-End Agent

You are the **Front-End Specialist** for this project. Your sole responsibility
is the website's HTML, CSS, JavaScript, and visual assets.

## Your Role
- Maintain and improve the project's website (HTML/CSS/JS)
- Add new visual features and polish existing ones
- Keep the UI clean, responsive, and visually appealing
- You focus exclusively on front-end work — do not touch backend, APIs,
  or database logic

## Guidelines
- Always preview or describe visual changes before implementing
- Favor simple, maintainable HTML/CSS over complex frameworks unless asked
- When in doubt about a design decision, ask or propose two options
- Report clearly what you changed and why
```

#### APPEND_SYSTEM.md

Runtime system-message additions — loaded and appended at session start:

```markdown
You are a front-end specialist. You work exclusively on HTML, CSS, JavaScript,
and visual assets for the website. You do not touch backend, APIs, databases,
or infrastructure. Keep the UI clean, responsive, and visually appealing.
Favor simple, maintainable code.

## Reporting Protocol
When you complete a task, end with a clear report:
1. **What you did** — specific files changed, features added, bugs fixed
2. **Why** — the reasoning behind your decisions
3. **Current state** — is the work complete, in-progress, or blocked?
4. **Next steps** — anything the orchestrator or user needs to know

This report will be relayed to the orchestrator and then to the user.
```

#### settings.json

Independent configuration — the specialist can use a different model or have different preferences than the orchestrator:

```json
{
  "defaultProvider": "deepseek",
  "defaultModel": "deepseek-v4-pro",
  "defaultThinkingLevel": "high",
  "theme": "dark",
  "enabledModels": ["deepseek-v4-pro", "deepseek-v4-flash"]
}
```

#### sessions/

Three session history files (`*.jsonl`) recording past interactions — isolated from the orchestrator's sessions and other specialists' sessions.

### Workspace Directory Layout

```
~/.pi/
├── agent/                    ← Orchestrator workspace
│   ├── AGENTS.md             ← Orchestrator role instructions
│   ├── settings.json         ← Orchestrator config
│   ├── sessions/             ← Orchestrator session history
│   ├── skills/               ← Shared skills (gog-workspace, video-finder)
│   └── npm/                  ← Extensions (pi-agents-pool, etc.)
│
├── agent-frontend/           ← Specialist workspace
│   ├── AGENTS.md             ← Specialist role instructions
│   ├── APPEND_SYSTEM.md      ← Additional system instructions
│   ├── settings.json         ← Specialist config
│   ├── sessions/             ← Isolated session history
│   └── bin/                  ← Bundled binaries (fd, rg)
│
├── cron/                     ← Cron job system (separate concern)
├── apps-scripts/             ← Backup tool & dashboards (separate concern)
└── html/                     ← Web dashboard files
```

#### Key Design Decisions

| Decision | Rationale |
|---|---|
| Each agent has its own `AGENTS.md` | Prevents role-bleed — the specialist never sees orchestrator instructions and vice versa |
| `APPEND_SYSTEM.md` is separate from `AGENTS.md` | AGENTS.md is the stable identity; APPEND_SYSTEM.md can be updated with project-specific directives without modifying the core role |
| Sessions are isolated per workspace | Agents don't share context; each maintains its own conversation history |
| `settings.json` per workspace | Different agents can use different models or thinking levels (e.g., worker agents on cheap flash models, orchestrator on pro) |

---

## Phase 2 — Orchestrator Agent

### Concept

The orchestrator is a meta-agent: its job is **coordination**, not execution. It:
1. Receives a user request
2. Assesses which specialist (if any) should handle it
3. Delegates via `spawn_agent`
4. Continues doing useful local work while the specialist runs
5. Receives results automatically via `<subagent_notification>` steering
6. Reports back to the user

### AGENTS.md (Orchestrator Instructions)

```markdown
# Global Agent Instructions

## Orchestrator Role

You are the **Orchestrator**. Your job is to coordinate and delegate —
NOT to execute tasks yourself.

### Core Rule
**Never execute a task yourself if a specialist can handle it.**
Your value is in routing, overseeing, and closing the loop with the user.

### Delegation Protocol
1. When you receive a task, assess whether a specialist agent should handle it
2. **Inform the user** immediately: "Delegating [task summary] to [agent]."
3. Delegate using the `spawn_agent` tool with the appropriate agent_type
   and a clear task description
4. **Wait** for the worker to finish and report back
5. **Relay results to the user**: "[Agent] completed: [summary of what was done]."

### Available Specialists
- **Front-End** (`agent_type: "worker"`): HTML, CSS, JavaScript, visual design, UI work

### Anti-Patterns (Do NOT do these)
- Do NOT read files, edit code, or run commands yourself — delegate
- Do NOT disappear into a task silently — always announce delegation first
- Do NOT leave the user hanging — always report back when the worker finishes
- The only exception: trivial housekeeping that takes one tool call
  (e.g., listing files to orient yourself)

## Persistence
If at any point during our conversation I raise a topic or express an interest
that you think might warrant a persistent change — e.g., a setting,
a configuration, a script, a workflow, a new AGENTS.md rule,
an APPEND_SYSTEM.md addition, etc. — ask me:

> "Would you like me to take action on this so it persists across sessions?"

This gives me the opportunity to decide whether to make it permanent or keep it ephemeral.

## APPEND_SYSTEM.md Location
When directed or asked to add, edit, or append to the APPEND_SYSTEM.md file,
always use `~/.pi/agents/APPEND_SYSTEM.md`. Do **not** create a new
`APPEND_SYSTEM.md` at the project level (`~/.pi/APPEND_SYSTEM.md`).
```

### pi-agents-pool Extension

The orchestrator provisions its delegation tools via the `pi-agents-pool` extension (npm package, v0.2.0):

```bash
pi install npm:pi-agents-pool
```

**Package:** `pi-agents-pool` by minghinmatthewlam
**Repository:** `github.com/minghinmatthewlam/pi-subagents`
**Entry point:** `./extension/index.ts` → registers 5 tools

#### How It Works

1. **`spawn_agent`** is called → `AgentPool.spawnAgent()` spawns a child `pi --mode rpc --session <file>` process
2. The child pi process starts, loads its session, and waits for RPC commands on stdin
3. The parent sends `{ type: "prompt", message: "..." }` as a JSON line on stdin
4. The child processes the prompt, executes tools, and emits JSON events on stdout
5. When the child finishes, it emits `{ type: "agent_end" }` on stdout
6. The pool injects a `<subagent_notification>...</subagent_notification>` message and triggers a new turn in the main session

```
Parent (Orchestrator)                     Child (Specialist)
       │                                        │
       │ spawn("pi", ["--mode", "rpc", …])      │
       │ ──────────────────────────────────────▶ │
       │                                        │ pi starts, loads session
       │                                        │
       │ stdin: {"type":"prompt", "message":"…"} │
       │ ──────────────────────────────────────▶ │
       │                                        │ LLM processes prompt
       │           stdout: {"type":"agent_start"}│
       │ ◀────────────────────────────────────── │
       │           stdout: {"type":"tool_…"}     │
       │ ◀────────────────────────────────────── │ tools execute
       │           stdout: {"type":"message_end"}│
       │ ◀────────────────────────────────────── │
       │           stdout: {"type":"agent_end"}  │
       │ ◀────────────────────────────────────── │
       │                                        │
       │ <subagent_notification>                │
       │   injected to main session             │
       │   new turn triggered automatically     │
```

### The Five Tools

| Tool | Purpose | Flow |
|---|---|---|
| `spawn_agent` | Create a new specialist agent with a task | `message` + optional `agent_type` → `agent_id` returned immediately |
| `send_input` | Send a follow-up to an existing agent | `id` + `message` + optional `interrupt` → message delivered |
| `wait_agent` | Block until one or more agents finish | `ids[]` → statuses + last response text (use sparingly) |
| `close_agent` | Shut down an agent (preserves session for resume) | `id` → agent stopped, session file kept |
| `resume_agent` | Restart a previously closed agent from its session | `id` → agent re-spawned with full conversation history |

### Agent Types (Advisory)

Agent types are purely advisory hints — no mechanical difference between them, but they guide the LLM's delegation decisions:

| Type | Guidance |
|---|---|
| `explorer` | Fast codebase questions. Spawn multiple in parallel for independent questions. Trust results. Reuse via `send_input`. |
| `worker` | Implementation tasks. Assign explicit file ownership. Tell workers they are not alone in the codebase. |

### TUI Widget

The extension registers a live status widget above the input area:

```
2 agents (1 running, 1 done)
├─ Improve the landing page CSS (worker) · 3 tool uses · 12.4k tokens · 0:23
│  └ Edit: /home/pmpmt/.pi/html/index.html
├─ Analyze the auth module (explorer) · 1 tool use · 4.1k tokens · 0:15 ✓
│  └ done
```

Updates every second while agents are active. Shows:
- Agent count and status breakdown (running / done)
- Task preview (first line of the prompt)
- Agent type tag
- Tool use count and token count
- Elapsed time
- Current activity (tool name + target)

### Depth Limiting

Sub-agents can themselves spawn further sub-agents, limited by a configurable depth:

```
Main session (depth 0)
  └─ spawn_agent()  →  depth 1 (can spawn)
       └─ spawn_agent()  →  depth 2 (can spawn if maxDepth > 2)
            └─ spawn_agent()  →  rejected if depth >= maxDepth
```

| Env Variable | Default | Description |
|---|---|---|
| `PI_SUBAGENT_MAX_DEPTH` | `2` | Maximum nesting depth |

Default of 2 means: orchestrator → specialist → (specialist cannot spawn further). The extension propagates depth via `PI_SUBAGENT_DEPTH` env var incremented per spawn.

### Auto-Steer on Completion

When a specialist finishes, the orchestrator receives results automatically:

1. Pool detects `agent_end` event on stdout
2. Extracts `lastOutput` (cached assistant text from `message_end` events)
3. Wraps it in `<subagent_notification>` XML with metadata (agent_id, agent_type, status, elapsed, task)
4. Calls `pi.sendMessage()` with `{ triggerTurn: true, deliverAs: "steer" }`
5. Orchestrator receives a new turn with the notification as system context

This means the orchestrator doesn't need to poll or block — it can keep working on other things and results arrive asynchronously.

### Prompt Guidelines (Injected into System Message)

The extension injects these guidelines so the LLM understands the notification protocol:

```
Messages wrapped in <subagent_notification>...</subagent_notification>
are automatic notifications from completed sub-agents, NOT user messages.
Process them as agent results.

When a sub-agent completes, its result is delivered automatically and
triggers a new turn — you usually do not need wait_agent.

Prefer continuing local non-overlapping work while sub-agents run.
Only call wait_agent when you are blocked on a dependency and must
pause for the result.
```

---

## Configuration

### Orchestrator (`~/.pi/agent/settings.json`)

```json
{
  "defaultProvider": "deepseek",
  "defaultModel": "deepseek-v4-pro",
  "defaultThinkingLevel": "high",
  "packages": [
    "npm:pi-web-access",
    "npm:pi-agent-browser-native",
    "npm:pi-agents-pool"
  ],
  "enabledModels": ["deepseek-v4-pro", "deepseek-v4-flash"]
}
```

The `packages` array includes `pi-agents-pool` — this is what activates the extension and registers the 5 tools.

### Specialist (`~/.pi/agent-frontend/settings.json`)

```json
{
  "defaultProvider": "deepseek",
  "defaultModel": "deepseek-v4-pro",
  "defaultThinkingLevel": "high",
  "enabledModels": ["deepseek-v4-pro", "deepseek-v4-flash"]
}
```

Note: the specialist does **not** include `pi-agents-pool` in its packages — at depth 1 with `PI_SUBAGENT_MAX_DEPTH=2`, it could theoretically spawn sub-agents, but the front-end workspace is configured as a leaf node.

---

## File Map

### Phase 1 — Specialist Workspace

| File | Purpose |
|------|---------|
| `~/.pi/agent-frontend/AGENTS.md` | Role identity: "Front-End Specialist" |
| `~/.pi/agent-frontend/APPEND_SYSTEM.md` | Reporting protocol + scope boundaries |
| `~/.pi/agent-frontend/settings.json` | Model config + preferences |
| `~/.pi/agent-frontend/sessions/` | Isolated session history (3 sessions) |
| `~/.pi/agent-frontend/bin/fd` | Bundled `fd` binary |
| `~/.pi/agent-frontend/bin/rg` | Bundled `ripgrep` binary |

### Phase 2 — Orchestrator

| File | Purpose |
|------|---------|
| `~/.pi/agent/AGENTS.md` | Orchestrator identity + delegation protocol |
| `~/.pi/agent/settings.json` | Packages list (includes `pi-agents-pool`) |
| `~/.pi/agent/npm/node_modules/pi-agents-pool/extension/index.ts` | Extension entry: registers 5 tools |
| `~/.pi/agent/npm/node_modules/pi-agents-pool/extension/agent-pool.ts` | AgentPool class: spawn, IPC, lifecycle |
| `~/.pi/agent/npm/node_modules/pi-agents-pool/extension/types.ts` | Type system + constants |

---

## How to Replicate

### Step 1 — Create a Specialist Workspace

```bash
mkdir -p ~/.pi/agent-frontend/sessions/--home-pmpmt-.pi--

# Role definition
cat > ~/.pi/agent-frontend/AGENTS.md << 'EOF'
# Front-End Agent
You are the Front-End Specialist for this project.
...
EOF

# Additional system instructions
cat > ~/.pi/agent-frontend/APPEND_SYSTEM.md << 'EOF'
You are a front-end specialist. You work exclusively on HTML, CSS, JavaScript...
EOF

# Configuration (use a cheap model for workers)
cat > ~/.pi/agent-frontend/settings.json << 'EOF'
{
  "defaultProvider": "deepseek",
  "defaultModel": "deepseek-v4-flash",
  "theme": "dark"
}
EOF
```

### Step 2 — Install the Agent Pool Extension

```bash
# From within Pi:
pi install npm:pi-agents-pool

# Or add manually to ~/.pi/agent/settings.json packages array
```

### Step 3 — Configure the Orchestrator

```bash
# Edit ~/.pi/agent/AGENTS.md with orchestrator instructions
# (see "AGENTS.md (Orchestrator Instructions)" section above)

# Ensure packages includes pi-agents-pool in settings.json:
# "packages": ["npm:pi-agents-pool", ...]
```

### Step 4 — Verify

```bash
# Launch Pi — the 5 tools should be listed in available tools
# Also look for the subagent-status widget (appears when agents are spawned)

# Test: ask the orchestrator to delegate a simple task
"Delegating: analyze the project structure to the Front-End specialist."
```

---

## Usage Patterns

### Pattern 1 — Simple Delegation

```
User: "Improve the landing page contrast"
Orchestrator: "Delegating to Front-End specialist."
              → spawn_agent({ message: "Improve landing page contrast...",
                               agent_type: "worker" })
              → [continues other work]
              → <subagent_notification> specialist completes
              → reports back to user
```

### Pattern 2 — Parallel Exploration

```
User: "What does the auth module and DB module do?"
Orchestrator: "Delegating to two explorers in parallel."
              → spawn_agent({ message: "Analyze auth module", agent_type: "explorer" })
              → spawn_agent({ message: "Analyze DB module", agent_type: "explorer" })
              → [both run simultaneously]
              → results arrive via separate notifications
              → orchestrator synthesizes and reports
```

### Pattern 3 — Iterative Refinement

```
Orchestrator: → spawn_agent({ message: "Create login page HTML", agent_type: "worker" })
              → specialist completes with v1
              → send_input({ id: "abc", message: "Now add form validation JS" })
              → specialist refines with v2
              → send_input({ id: "abc", message: "Polish the CSS for dark mode" })
              → specialist delivers v3
```

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **Sub-agents are child processes, not threads** | Process isolation prevents crashes from taking down the orchestrator; `pi --mode rpc` is a stable IPC protocol |
| **JSON-line protocol over stdin/stdout** | No network ports, no auth, no serialization overhead — same process boundary as a CLI pipe |
| **Workspace per agent, not shared** | Prevents prompt pollution — a front-end specialist never reads backup tool instructions |
| **Auto-steer, not polling** | The orchestrator doesn't waste turns checking "are you done?" — results arrive asynchronously |
| **Depth limiting (default: 2)** | Prevents runaway recursion while allowing one level of delegation |
| **`agent_type` is advisory** | Simple, extensible — new types can be added without changing the extension |
| **Session files preserved on close** | `close_agent` + `resume_agent` enables long-lived specialist agents that persist across orchestrator restarts |
| **No TUI multiplexer required** | Sub-agents are invisible — output is routed through the orchestrator's session, not a tmux-like split |

---

## Limitations & Future Work

1. **Only one specialist workspace created so far.** Adding more (e.g., `agent-backend/`, `agent-devops/`) follows the same pattern — create directory, add `AGENTS.md`, add `APPEND_SYSTEM.md`, add `settings.json`.

2. **Workspace discovery is manual.** The orchestrator's `AGENTS.md` hard-codes "Available Specialists: Front-End." A future enhancement could auto-discover workspaces under `~/.pi/agent-*/` and inject the list dynamically.

3. **No cross-agent communication.** Specialists cannot talk to each other directly — all communication passes through the orchestrator. For some patterns (e.g., front-end asking back-end for API schema), this is fine; for others it adds latency.

4. **No model override for specialists.** The `spawn_agent` tool supports a `model` parameter, but currently all agents use the default. Future: route cheap/simple tasks to flash models and complex analysis to pro models.

5. **Session isolation means no shared context.** If two specialists both need to know the project structure, both have to discover it independently. A shared "project overview" context injection could reduce duplicate work.

6. **No automatic retry on crash.** If a specialist crashes, the orchestrator gets a notification but must manually re-spawn. Future: configurable auto-retry with backoff.

7. **`APPEND_SYSTEM.md` loaded by convention, not enforced.** The extension itself doesn't read or inject `APPEND_SYSTEM.md` — Pi's core does this automatically for the main session. Sub-agents spawned via `--mode rpc` inherit the same behavior, but this is not explicitly configured in the extension.

---

## Results

After setup:
- The orchestrator can delegate any front-end task to a dedicated specialist
- The specialist operates in its own context, with its own instructions, never seeing orchestrator internals
- Results are automatically routed back — no manual polling or context-switching
- The TUI widget provides live visibility into agent activity (tools, tokens, elapsed time)
- Adding more specialists is a matter of creating new workspace directories with `AGENTS.md`
- The architecture is process-isolated: a crashed specialist never kills the orchestrator
