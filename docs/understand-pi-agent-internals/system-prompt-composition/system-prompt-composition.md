# Pi Prompt Structure — What the LLM Receives

**Date:** 2026-07-25
**System:** Ubuntu 24.04 (Pi v0.81.1)
**Sources:** `system-prompt.js`, `agent-loop.js`, `agent-session.js`
**Live verification:** System prompt captured to `/tmp/pi-system-prompt.txt` — 13,165 chars

---

## Overview

Every LLM call sends **three things**: the system prompt, the conversation history, and tool definitions. The system prompt is fixed per session (assembled once by `buildSystemPrompt()`). The conversation history grows with every turn. Together they form the full context.

```
FINAL PROMPT TO LLM:

┌─────────────────────────────────────────┐
│ SYSTEM PROMPT (fixed, ~13K chars)       │
│  1. Agent identity                      │
│  2. Available tools (one-liners)        │
│  3. Guidelines (auto + tool-specific)   │
│  4. Pi documentation paths              │
│  5. APPEND_SYSTEM.md content            │
│  6. <project_context> AGENTS.md files   │
│  7. <available_skills> XML block        │
│  8. Current working directory           │
├─────────────────────────────────────────┤
│ CONVERSATION HISTORY (grows each turn)  │
│  • User messages (text + images)        │
│  • Assistant responses                  │
│  • Tool call results                    │
│  • !bash command output                 │
│  • Compaction summaries (if compacted)  │
│  • Extension-injected messages          │
├─────────────────────────────────────────┤
│ TOOL DEFINITIONS (JSON schemas)         │
│  • Active tool parameter schemas        │
└─────────────────────────────────────────┘
```

---

## Part 1: System Prompt

Assembled by `buildSystemPrompt()` in `system-prompt.js`. Static within a session — only changes via `before_agent_start` hook modifications.

### 1. Agent Identity (always present)

```
You are an expert coding assistant operating inside pi, a coding agent harness. 
You help users by reading files, executing commands, editing code, and writing new files.
```

Hardcoded. Cannot be changed without modifying Pi source.

### 2. Available Tools (dynamic)

Built from the `toolSnippets` map. A tool appears here only if it provides a `promptSnippet`:

```
Available tools:
- read: Read file contents
- bash: Execute bash commands (ls, grep, find, etc.)
- edit: Make precise file edits with exact text replacement...
- write: Create or overwrite files
- web_search: Use for web research questions...
- fetch_content: Use to extract readable content...
- get_search_content: Use after web_search/fetch_content...
- agent_browser: Browse websites, read live docs...
- spawn_agent: Spawn sub-agents for parallel or delegated work...
```

Tools without `promptSnippet` are still callable but don't appear in this list.

### 3. Guidelines (auto-generated + tool-specific + always)

Three sources, deduplicated:

| Source | Example |
|--------|---------|
| **Auto-detected** | "Use bash for file operations like ls, rg, find" (when bash active but grep/find/ls not) |
| **Tool `promptGuidelines`** | "Use agent_browser for real browser or live web content." |
| **Always appended** | "Be concise in your responses", "Show file paths clearly when working with files" |

### 4. Pi Documentation Paths (always present)

Points to installed npm package paths so the LLM can `read` Pi's own docs when asked.

### 5. Custom Append — APPEND_SYSTEM.md / `--append-system-prompt`

Inserted directly after Pi docs, **before** project context. Raw markdown — NOT wrapped in `<project_context>` tags.

Sources checked (in order):
- `~/.pi/agent/APPEND_SYSTEM.md` (global)
- `.pi/APPEND_SYSTEM.md` (project-local)
- `--append-system-prompt` CLI flag

### 6. Project Context — AGENTS.md / CLAUDE.md

All discovered context files, wrapped in `<project_context>` tags:

```xml
<project_context>
<project_instructions path="/home/pmpmt/.pi/agent/AGENTS.md">
...full content...
</project_instructions>
</project_context>
```

Discovery order:
1. `~/.pi/agent/AGENTS.md` or `CLAUDE.md` (global)
2. Parent directories walking up from cwd → root
3. Current working directory

### 7. Skills (if `read` tool is active)

XML block with name, description, and file path for each loaded skill. The LLM uses `read` to load full `SKILL.md` content on demand (progressive disclosure). Skills with `disable-model-invocation: true` are excluded.

```xml
<available_skills>
  <skill>
    <name>gog-workspace</name>
    <description>Google Workspace CLI for Gmail, Calendar, Drive...</description>
    <location>/home/pmpmt/.pi/agent/skills/gog-workspace/SKILL.md</location>
  </skill>
</available_skills>
```

### 8. Current Working Directory (always present)

```
Current working directory: /home/pmpmt
```

---

## Custom Prompt Mode (SYSTEM.md / `--system-prompt`)

If a custom system prompt is provided, sections 1–4 are **replaced** by custom text. Sections 5–8 still append:

```
[custom prompt]
[APPEND_SYSTEM.md content]
[project_context with AGENTS.md files]
[skills]
Current working directory: /home/pmpmt
```

Custom prompt sources:
1. `.pi/SYSTEM.md` (project-local)
2. `~/.pi/agent/SYSTEM.md` (global)
3. `--system-prompt` CLI flag

---

## Part 2: Conversation History

After the system prompt, every message in the session is sent. This grows with each turn.

### Message Types Sent

| Type | Source | Notes |
|------|--------|-------|
| **User messages** | Your input | Text + optional images (pasted or `@file`) |
| **Assistant responses** | LLM output | Streamed token-by-token, including thinking blocks |
| **Tool results** | Tool execution | The output of `read`, `bash`, `edit`, `write`, etc. |
| **Bash execution** | `!command` in editor | Sent to LLM; `!!command` runs without sending |
| **Custom messages** | Extension-injected | Via `before_agent_start` or `sendCustomMessage()` |
| **Compaction summaries** | Automatic/manual compaction | Older messages summarized into a single entry |
| **Branch summaries** | `/tree` navigation | Context from abandoned branches |

### File References (`@file`)

CLI file arguments are included in the initial user message:

```bash
pi @README.md "summarize this"
```

### Images

Pasted (Ctrl+V) or `@image.png` references become base64-encoded content blocks in user messages.

### Extension Interception Points

Two hooks can modify what reaches the LLM:

| Hook | Can… |
|------|------|
| `before_agent_start` | Inject custom messages or modify the system prompt |
| `context` | Filter or mutate the entire message array before each LLM call |

---

## Part 3: Tool Definitions

Alongside the system prompt and history, the LLM receives JSON schemas for every active tool. These describe the tool's name, description, and parameter structure so the model can produce valid structured tool calls.

---

## Compaction

When the conversation history approaches the model's context window limit, older messages are summarized. The LLM sees:

```
[System prompt]
[Compaction summary of old messages]
[Recent unsummarized messages]
```

Full history remains in the session JSONL file — compaction only affects what the model sees.

---

## Verification

The full system prompt was captured from a live session:

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  writeFileSync("/tmp/pi-system-prompt.txt", ctx.getSystemPrompt());
});
```

Inspect at `/tmp/pi-system-prompt.txt` after any prompt.

---

## Session Progress Checkpoint

This document is part of the Pi Agent internals investigation:

1. ✅ **Extension discovery** — `extension-discovery-and-event-lifecycle/`
2. ✅ **Full event lifecycle** — 28/32 events verified, hooks vs events catalogued
3. ✅ **Core agent loop** — `core-agent-loop/`
4. ✅ **AgentSession preflight** — command expansion, input hooks, auth, compaction
5. ✅ **Prompt structure** — this document — system prompt + conversation history + tool definitions

**The full stack:**

```
LLM receives:      [System Prompt] + [Conversation History] + [Tool Definitions]
                         ↑
buildSystemPrompt()      │  system-prompt.js
                         ↑
AgentSession.prompt()    │  agent-session.js (preflight)
                         ↑
Agent.prompt()           │  agent.js (snapshot + invoke loop)
                         ↑
runLoop()                │  agent-loop.js (inner/outer loops)
                         ↑
tool execution           │  agent-loop.js (parallel/sequential)
                         ↑
Extension hooks          │  ExtensionRunner
                         ↑
Session persistence      │  SessionManager (JSONL trees)
```
