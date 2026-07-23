# Pi Agent — All Startup Options

> Quick reference for all the ways to launch Pi from the terminal.
> Last updated: 2025-07 (Pi CLI `--help` output).

---

## Modes (how Pi runs)

| Flag/Option | Description |
|-------------|-------------|
| *(default)* | **Interactive mode** — full TUI with editor, commands, keyboard shortcuts |
| `-p`, `--print` | **Print mode** — non-interactive: process the prompt and exit. Reads piped stdin |
| `--mode json` | **JSON mode** — outputs all events as JSON lines (for programmatic consumption) |
| `--mode rpc` | **RPC mode** — stdin/stdout JSONL protocol for process integration |

## Session Management

| Flag/Option | Description |
|-------------|-------------|
| *(default)* | New session in current working directory |
| `-c`, `--continue` | **Continue** the most recent session |
| `-r`, `--resume` | **Resume** — browse and pick from past sessions |
| `--session <path\|id>` | Use a **specific session** by file path or partial UUID |
| `--fork <path\|id>` | **Fork** a session — copy it into a new session and start fresh |
| `--no-session` | **Ephemeral mode** — don't save anything to disk |
| `--name <name>`, `-n <name>` | Set a **display name** for the session at startup |
| `--session-dir <dir>` | Custom session storage directory |

## Resource Control ("no-*" / clean startup)

| Flag/Option | Short | Description |
|-------------|-------|-------------|
| `--no-context-files` | `-nc` | Disable **AGENTS.md / CLAUDE.md** context file discovery |
| `--no-extensions` | `-ne` | Disable **extension** discovery |
| `--no-skills` | `-ns` | Disable **skill** discovery |
| `--no-prompt-templates` | `-np` | Disable **prompt template** discovery |
| `--no-themes` | *(none)* | Disable **theme** discovery |
| `--no-tools` | `-nt` | Disable **all tools** (built-in + extensions) |
| `--no-builtin-tools` | `-nbt` | Disable only **built-in tools** (extensions still active) |

## Tool Selection

| Flag/Option | Description |
|-------------|-------------|
| `--tools <list>`, `-t <list>` | **Allowlist** specific tools (e.g. `read,bash,edit,write`) |
| `--exclude-tools <list>`, `-xt <list>` | **Denylist** specific tools |

Available built-in tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`

## Model & Thinking

| Flag/Option | Description |
|-------------|-------------|
| `--provider <name>` | Select provider (anthropic, openai, google, etc.) |
| `--model <pattern>` | Model pattern/ID; supports `provider/id` and `id:thinking` shorthand |
| `--models <patterns>` | Comma-separated patterns for Ctrl+P model cycling |
| `--thinking <level>` | Thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `--api-key <key>` | API key override |
| `--list-models [search]` | List available models |

## Resource Loading

| Flag/Option | Description |
|-------------|-------------|
| `-e`, `--extension <path>` | Load a specific extension (repeatable) |
| `--skill <path>` | Load a specific skill (repeatable) |
| `--prompt-template <path>` | Load a specific prompt template (repeatable) |
| `--theme <path>` | Load a specific theme (repeatable) |

## Trust, System Prompt & Other

| Flag/Option | Description |
|-------------|-------------|
| `-a`, `--approve` | Trust project-local files for this run |
| `-na`, `--no-approve` | Ignore project-local files for this run |
| `--offline` | Disable all startup network operations (same as `PI_OFFLINE=1`) |
| `--verbose` | Force verbose startup header |
| `--system-prompt <text>` | Replace the default system prompt |
| `--append-system-prompt <text>` | Append to the system prompt |
| `--export <in> [out]` | Export a session to HTML and exit |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show version |

## File Arguments

Prefix files with `@` to include them in the initial message:

```bash
pi @prompt.md "Answer this"
pi -p @screenshot.png "What's in this image?"
pi @code.ts @test.ts "Review these files"
```

---

## Common Combos

```bash
# === Quick / one-shot ===
pi -p "Summarize this codebase"               # One-shot, print & exit
cat README.md | pi -p "Summarize this text"   # Piped stdin
pi "List all .ts files in src/"               # Interactive with initial prompt

# === Session management ===
pi -c                              # Continue last session
pi -c "What did we discuss?"       # Continue last session with prompt
pi -r                              # Browse & pick a past session
pi --name "Refactor auth"          # Named session
pi --no-session                    # Ephemeral (don't save)

# === Clean / minimal startup ===
pi -nc                             # No context files (AGENTS.md)
pi -nc -ne -ns -np                 # Bare: no context, extensions, skills, or templates
pi -nc -nt                         # No context + no tools at all
pi -nc -ne                         # No context + no extensions

# === Model selection ===
pi --provider openai --model gpt-4o "Help me refactor"
pi --model openai/gpt-4o "Help me refactor"      # Provider prefix (no --provider needed)
pi --model sonnet:high "Solve this"              # Model + thinking level shorthand
pi --models "claude-*,gpt-4o"                   # Limit Ctrl+P cycling

# === Read-only mode ===
pi --tools read,grep,find,ls -p "Review the code"

# === Thinking levels ===
pi --thinking high "Solve this complex problem"
pi --thinking off "Quick question"

# === Trust override ===
pi -a              # Trust project files for this run
pi -na             # Ignore project files for this run

# === Offline ===
pi --offline       # No network at startup
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GOOGLE_AI_STUDIO_API_KEY` | Google Gemini API key |
| `PI_CODING_AGENT_DIR` | Override config directory (default: `~/.pi/agent`) |
| `PI_OFFLINE` | Disable startup network operations |
| `PI_SKIP_VERSION_CHECK` | Skip version update check |
| `PI_TELEMETRY` | `0`/`false` to disable telemetry |
| `PI_CACHE_RETENTION` | `long` for extended prompt cache |
| `VISUAL`, `EDITOR` | External editor for Ctrl+G |
