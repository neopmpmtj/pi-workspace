# Pi System Prompt Composition — Analysis Report

**Date:** 2026-07-25
**System:** Ubuntu 24.04 (Pi v0.81.1)
**Source:** `@earendil-works/pi-coding-agent/dist/core/system-prompt.js`
**Live verification:** Full prompt captured to `/tmp/pi-system-prompt.txt` — 13,165 chars

---

## Overview

Every LLM call sends the full system prompt. It is assembled by `buildSystemPrompt()` in `system-prompt.js` and never changes mid-session (except via `before_agent_start` hook modifications). The composition follows a strict order.

---

## The 8 Sections (in order)

### 1. Agent Identity (always present)

Fixed text that establishes Pi's role:

```
You are an expert coding assistant operating inside pi, a coding agent harness. 
You help users by reading files, executing commands, editing code, and writing new files.
```

This is hardcoded in `system-prompt.js`. Cannot be changed without modifying Pi source.

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

Only tools with `promptSnippet` appear here. Tools without one (like `save_note` from the notes demo) are still callable but don't get a one-line listing.

### 3. Guidelines (auto-generated + tool-specific + always)

Three sources merged with deduplication:

| Source | Example |
|--------|---------|
| **Auto-detected** | "Use bash for file operations like ls, rg, find" (when bash is active but grep/find/ls are not) |
| **Tool `promptGuidelines`** | "Use agent_browser for real browser or live web content." — from pi-agent-browser-native |
| **Always appended** | "Be concise in your responses", "Show file paths clearly when working with files" |

### 4. Pi Documentation Paths (always present)

```
Pi documentation (read only when the user asks about pi itself...):
- Main documentation: /home/pmpmt/.nvm/.../README.md
- Additional docs: /home/pmpmt/.nvm/.../docs
- Examples: /home/pmpmt/.nvm/.../examples
```

Points to the installed npm package paths so the LLM can `read` Pi's own docs.

### 5. Custom Append — APPEND_SYSTEM.md / `--append-system-prompt`

Inserted directly after Pi docs, **before** project context and skills. In this installation:

```
# User Location Context
## Detected Location
- **Country**: Portugal (PT)
- **City**: Vila Real
...

# Secrets Management Rule
All API keys, tokens, credentials, and other secrets MUST be stored in `~/.pi/agent/.env`...

# CLI Tool Hygiene
Skill docs can be stale. Before using a CLI tool from a skill...
```

This comes from `~/.pi/agent/APPEND_SYSTEM.md`. It is NOT wrapped in `<project_context>` tags — it's raw markdown injected directly into the prompt.

Sources checked (in order):
- `~/.pi/agent/APPEND_SYSTEM.md` (global)
- `.pi/APPEND_SYSTEM.md` (project-local)
- `--append-system-prompt` CLI flag

### 6. Project Context — AGENTS.md / CLAUDE.md

All discovered context files wrapped in `<project_context>` tags:

```xml
<project_context>
<project_instructions path="/home/pmpmt/.pi/agent/AGENTS.md">
## Orchestrator Role
You are the **Orchestrator**. Your job is to coordinate and delegate...
...
## CLI Tool Hygiene
...
## APPEND_SYSTEM.md Location
...
</project_instructions>
</project_context>
```

Discovered from (in order):
1. `~/.pi/agent/AGENTS.md` (global)
2. Parent directories walking up from cwd
3. Current directory

In this session, only the global AGENTS.md loads because:
- `~/.pi/AGENTS.md` exists but is **empty** (0 bytes)
- cwd is `~/.pi/` so no project-local AGENTS.md

### 7. Skills (if `read` tool is active)

Only injected when the `read` tool is enabled. This is because skills instruct the LLM to `read` their SKILL.md files — without the `read` tool, skills are useless:

```xml
<available_skills>
  <skill>
    <name>gog-workspace</name>
    <description>Google Workspace CLI for Gmail, Calendar, Drive...</description>
    <location>/home/pmpmt/.pi/agent/skills/gog-workspace/SKILL.md</location>
  </skill>
  <skill>
    <name>video-finder</name>
    ...
  </skill>
  <skill>
    <name>librarian</name>
    ...
  </skill>
</available_skills>
```

### 8. Current Working Directory (always present)

```
Current working directory: /home/pmpmt
```

---

## Custom Prompt Mode (SYSTEM.md / `--system-prompt`)

If a custom system prompt is provided, sections 1–4 are **replaced** by the custom text. Sections 5–8 still append:

```
[custom prompt]
[APPEND_SYSTEM.md content]
[project_context with AGENTS.md files]
[skills]
Current working directory: /home/pmpmt
```

Custom prompt sources (checked in order):
1. `.pi/SYSTEM.md` (project-local)
2. `~/.pi/agent/SYSTEM.md` (global)
3. `--system-prompt` CLI flag

This installation has **no custom prompt** — section 1–4 is the default Pi agent text.

---

## Verification

The full 13,165-char prompt was captured from a live session using the event tracer:

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  writeFileSync("/tmp/pi-system-prompt.txt", ctx.getSystemPrompt());
});
```

The entire prompt can be inspected at `/tmp/pi-system-prompt.txt` after any prompt is sent.

---

## Session Progress Checkpoint

This completes the Pi Agent internals investigation:

1. ✅ **Extension discovery** — `extension-discovery-and-event-lifecycle/`
2. ✅ **Full event lifecycle** — 28/32 events verified, hooks vs events catalogued
3. ✅ **Core agent loop** — `core-agent-loop/` — inner/outer loops, queues, tool execution, stop conditions
4. ✅ **AgentSession preflight** — command expansion, input interception, skill/template expansion, auth, compaction, before_agent_start
5. ✅ **System prompt composition** — this document — all 8 sections verified from live capture

**The full stack, bottom to top:**

```
LLM receives:      [System Prompt] + [Conversation History]
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
Extension hooks          │  ExtensionRunner (tool_call, tool_result, context, etc.)
                         ↑
Session persistence      │  SessionManager (JSONL trees)
```
