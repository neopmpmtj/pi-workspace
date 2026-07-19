# Pi Prompt Structure: What the LLM Receives

A detailed breakdown of everything pi includes in the prompt sent to the language model —
from the system prompt and context files to skills, session history, and compaction summaries.

---

The message sent to the LLM consists of **two main parts**: the **system prompt** and the **conversation messages**.

## 1. System Prompt

The system prompt is built by `buildSystemPrompt()` in `system-prompt.js`. It's assembled from these components, in this order:

### A. Default System Prompt (or Custom via `SYSTEM.md`)
If no custom prompt is provided, pi uses a built-in default that includes:

- **Identity**: "You are an expert coding assistant operating inside pi, a coding agent harness..."
- **Available Tools**: A bullet list of tool names with one-line descriptions (e.g., `- read: Read file contents`, `- bash: Execute bash commands...`)
- **Custom tool note**: "In addition to the tools above, you may have access to other custom tools depending on the project."
- **Guidelines**: Tool-specific guidelines (e.g., "Use bash for file operations like ls, rg, find"), plus extension-added guidelines and always-present ones ("Be concise in your responses", "Show file paths clearly when working with files")
- **Pi documentation paths**: Pointers to pi's README, docs, and examples directories for when the user asks about pi itself
- **Current date**: e.g., `Current date: 2026-07-11`
- **Current working directory**: e.g., `Current working directory: /home/pmpmt/.pi/agent/testdir`

You can **replace** the default system prompt with `.pi/SYSTEM.md` (project) or `~/.pi/agent/SYSTEM.md` (global).

### B. Append System Prompt (`APPEND_SYSTEM.md`)
If `APPEND_SYSTEM.md` exists (project or global), its content is appended to the system prompt. The `--append-system-prompt` CLI flag also works.

### C. Project Context Files (`AGENTS.md` / `CLAUDE.md`)
Loaded from:
1. `~/.pi/agent/AGENTS.md` or `CLAUDE.md` (global)
2. Parent directories walking up from `cwd` → root
3. Current working directory

Each is wrapped in:
```
<project_context>
<project_instructions path="/path/to/AGENTS.md">
...content...
</project_instructions>
</project_context>
```

Note: if a **custom** system prompt is set (via `SYSTEM.md`), context files are still appended but **only if the `read` tool is available**.

### D. Skills (`<available_skills>` XML block)
If skills are loaded and the `read` tool is available, an XML block is appended:
```xml
<available_skills>
  <skill>
    <name>skill-name</name>
    <description>What this skill does...</description>
    <location>/path/to/skill/SKILL.md</location>
  </skill>
  ...
</available_skills>
```
This is progressive disclosure — only names/descriptions/locations are in the system prompt; the LLM uses `read` to load the full `SKILL.md` when needed. Skills with `disable-model-invocation: true` are excluded.

### E. Per-turn Modifications
Extensions can modify the system prompt at runtime via the `before_agent_start` event's `event.systemPrompt` or `ctx.getSystemPrompt()`. Extensions can also inspect `event.systemPromptOptions` to see what pi has loaded.

## 2. Conversation Messages

After the system prompt, the conversation history is built from `buildSessionContext()`:

### A. Session History (tree walk)
Walks from the current leaf to the root of the session tree, collecting:
- **User messages** - your input (text + images)
- **Assistant messages** - LLM responses (text, thinking, tool calls)
- **Tool results** - results from tool executions
- **Bash execution messages** - output from `!command` (unless `!!` which is excluded)
- **Compaction summaries** - summarized older messages
- **Branch summaries** - context from abandoned branches
- **Custom messages** - extension-injected context

### B. Compaction
If the conversation is too long, older messages are **summarized** via compaction. The LLM sees:
```
[System prompt]
[Compaction summary of old messages]
[Recent unsummarized messages]
```

### C. File References (`@file`)
When you pass `@filename` on the CLI (e.g., `pi @README.md "summarize"`), the file content is included in the initial user message.

### D. Images
Pasted images (Ctrl+V) or `@image.png` file references are included as base64-encoded image content blocks in user messages.

### E. `!command` Output
When you type `!command` in the editor, the bash output is sent as part of the conversation context (as a `BashExecutionMessage`). `!!command` runs without sending to the LLM.

### F. Extension Modifications
- The `context` event fires before each LLM call, allowing extensions to **filter/modify** the messages array
- The `before_agent_start` event allows extensions to **inject custom messages** (via `CustomMessageEntry`)
- The `input` event can transform your input before it reaches the LLM

---

## Summary Diagram

```
FINAL PROMPT TO LLM:

┌─────────────────────────────────────────┐
│ SYSTEM PROMPT                           │
│  ├─ Default system prompt (or SYSTEM.md)│
│  ├─ APPEND_SYSTEM.md content            │
│  ├─ <project_context>                   │
│  │   ├─ AGENTS.md (global)              │
│  │   ├─ AGENTS.md (parent dirs)         │
│  │   └─ AGENTS.md (cwd)                 │
│  ├─ <available_skills> (XML)            │
│  ├─ Current date                        │
│  └─ Current working directory           │
├─────────────────────────────────────────┤
│ CONVERSATION MESSAGES                   │
│  ├─ [Optional: compaction summary]      │
│  ├─ [Optional: branch summary]          │
│  ├─ User message (your input + @files)  │
│  ├─ Assistant response                  │
│  ├─ Tool results                        │
│  ├─ !bash command output                │
│  └─ Extension-injected messages         │
└─────────────────────────────────────────┘
```

Everything above is what reaches the LLM on each turn, subject to extension modifications through the `before_agent_start`, `context`, and `before_provider_request` hooks.