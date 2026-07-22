# Skill Doc Stale Commands — Debug & Architecture Fix

**Date:** 2026-07-19
**System:** Ubuntu 24.04 (gog v0.34.0, Pi)
**Location:** `~/.pi/agent/skills/gog-workspace/` (SKILL.md, scripts/generate-ref.sh, references/quickref.md) + `~/.pi/agent/AGENTS.md`

---

## Problem

A simple tool call failed:

```bash
$ gog drive files list --help
unexpected argument files
```

The agent had read `gog drive files list` from the gog-workspace skill's `SKILL.md` and executed it verbatim. The command doesn't exist — the correct subcommand is `gog drive ls`.

This is a **class of bug, not a one-off**. Every CLI tool documented in a skill file (`gog`, `gh`, `yt-dlp`, etc.) evolves independently of its static documentation. The SKILL.md was hand-written against an older `gog` version. When `gog` renamed `files list` → `ls`, the doc silently rotted.

The deeper question: why are we hardcoding CLI commands in static docs at all?

---

## Investigation / Root Cause

### The stale command chain

```
gog v0.2x-0.3x (when SKILL.md was written)     gog v0.34.0 (today)
──────────────────────────────────────────     ─────────────────
gog drive files list --parent ...        →      REMOVED / renamed
                                                 gog drive ls --parent ...
```

### Why it happened

The skill system loads `SKILL.md` as a static reference file. Agents read it and execute commands directly from it. There is no mechanism to validate commands against the live CLI before execution.

The system prompt already had a "CLI Tool Hygiene" rule (`Skill docs can be stale. Before using a CLI tool from a skill, run <tool> --help first`) but it was:
1. Buried in the system prompt, not in AGENTS.md
2. Easy to skip — agents often go straight for the documented command
3. A guideline, not enforced

### Key insight

Fixing the one stale command (`files list` → `ls`) just patches a symptom. The next `gog` update will break something else — `gog gmail messages search` might become `gog gmail msgs search`, etc. The real fix is to **stop hardcoding CLI commands in skill docs** and instead **teach the agent to discover commands from the live CLI at runtime**.

---

## Architecture / Design Decisions

### The fundamental shift

| Before | After |
|---|---|
| SKILL.md is a **command reference** (hardcoded syntax) | SKILL.md is a **capability guide** (what's possible, not exact commands) |
| Agent trusts documented commands blindly | Agent MUST run `gog <service> --help` before any command |
| quickref.md is hand-maintained (rots) | quickref.md is **auto-generated** from live CLI (`scripts/generate-ref.sh`) |
| No guard rail in AGENTS.md | AGENTS.md has permanent "CLI Tool Hygiene" rule |

### Three-layer defense against staleness

| Layer | What | How it prevents staleness |
|---|---|---|
| **1. Protocol** | `SKILL.md` § "Command Discovery Protocol" | Forces `--help` before every command. Source of truth is the live CLI, not the doc. |
| **2. Capabilities** | `SKILL.md` § "Capabilities by Service" | Describes *what* you can do (e.g., "list files in folders, search Drive, upload") without specifying exact subcommand names. Doesn't rot. |
| **3. Auto-generation** | `scripts/generate-ref.sh` → `references/quickref.md` | Dumps live `gog <service> --help` output. One command regenerates the entire reference. Never hand-edited. |

### Why auto-generate instead of runtime-only?

A pure runtime approach (agent always runs `--help`) is the most dynamic but adds latency for every command. The auto-generated reference provides a **cached convenience** — fast to read, while the protocol rule ensures the agent verifies if anything looks wrong.

---

## Implementation

### Phase 1 — Fix the immediate bug (SKILL.md)

**File:** `~/.pi/agent/skills/gog-workspace/SKILL.md`

Replaced the incorrect command:
```bash
# Before (broken)
gog drive files list --parent <folderId> --max 50 --json

# After (correct)
gog drive ls --max 50 --json
```

### Phase 2 — Add CLI Tool Hygiene to AGENTS.md

**File:** `~/.pi/agent/AGENTS.md`

Added a permanent section so every future session sees this rule, regardless of the system prompt:

```markdown
## CLI Tool Hygiene

Skill docs in `~/.pi/agent/skills/` can have stale or incorrect command names
because the CLI tools they document evolve independently. Before running any
command found in a skill's SKILL.md:

1. Run `<tool> --help` or `<tool> <subcommand> --help` first to verify.
2. If it fails, explore the parent command's help to discover the correct subcommand.
3. Then execute the verified command.

Pattern: `tool --help` → verify → execute.
```

### Phase 3 — Auto-generator script

**File:** `~/.pi/agent/skills/gog-workspace/scripts/generate-ref.sh`

A bash script that:
1. Runs `gog <service> --help` for each service (drive, gmail, calendar, contacts, sheets, docs)
2. Extracts the "Commands:" section from each help output
3. Strips subsection headers and blank lines
4. Writes a clean markdown reference to `references/quickref.md`

Key design choices:
- **No parsing of command syntax** — just captures the `--help` output verbatim. This means it can't misinterpret new command formats.
- **Idempotent** — running it multiple times produces the same output for the same `gog` version.
- **One command** — `bash scripts/generate-ref.sh` regenerates everything. No manual steps.

Output (380 lines for v0.34.0):
```markdown
# GOG Workspace — Auto-Generated Command Reference

> **Generated:** 2026-07-19 | **gog:** v0.34.0
> **Source of truth:** the live CLI. Run `scripts/generate-ref.sh` after any `gog` update.
> **At runtime:** always prefer `gog <service> --help` over this cached file.

## gog drive
  ls [flags]
    List files in a folder (default: root)
  search <query> ... [flags]
    Full-text search across Drive
  ...
```

### Phase 4 — Restructure SKILL.md as capability guide

**File:** `~/.pi/agent/skills/gog-workspace/SKILL.md` (full rewrite)

The rewrite eliminated all hardcoded command syntax from the body. Before:

```markdown
## Google Drive
```bash
gog drive search "type:document" --max 10
gog drive files list --parent <folderId> --max 50 --json   ← STALE
gog drive upload ./document.pdf --json
```
```

After:

```markdown
## 🚨 CRITICAL: Command Discovery Protocol
Before running ANY gog command:
1. Discover subcommands: `gog <service> --help`
2. Discover flags: `gog <service> <subcommand> --help`
3. Then execute with verified syntax

## Capabilities by Service

### Google Drive (`gog drive`)
**Capabilities:** List files in folders, full-text search, print folder trees,
get file metadata, download/upload files (with optional conversion to Google
formats), create folders, move/rename/delete files, share/unshare, manage
permissions and labels, list shared drives, track revisions and changes.

**Key patterns:**
- `--convert` converts Office files to native Google format on upload.
- File IDs are stable; save them for scripting.
```

### Phase 5 — Create `/document` command prompt

**File:** `~/.pi/agent/prompts/document.md`

A reusable prompt that auto-documents any session's fix/implementation following the pattern established by existing reports in `miscelaneous_documentation/`. Invoked as `/document` in the Pi TUI.

---

## Files Created/Modified

| File | Lines | Action | Purpose |
|---|---|---|---|
| `~/.pi/agent/skills/gog-workspace/SKILL.md` | ~160 | Rewritten | Capability-focused; no hardcoded commands |
| `~/.pi/agent/skills/gog-workspace/scripts/generate-ref.sh` | ~65 | **Created** | Auto-generates quickref from live CLI |
| `~/.pi/agent/skills/gog-workspace/references/quickref.md` | ~380 | Regenerated | Auto-generated command reference (v0.34.0) |
| `~/.pi/agent/AGENTS.md` | +10 | Modified | Added "CLI Tool Hygiene" section |
| `~/.pi/agent/prompts/document.md` | ~85 | **Created** | Reusable `/document` command prompt |

---

## Lessons

1. **Static docs + evolving CLI = guaranteed staleness.** The only defense is runtime verification (`--help`).

2. **Don't fix symptoms, fix the pattern.** Patching `files list` → `ls` would have left every other command vulnerable to the next `gog` update. The protocol + auto-generation combination makes the entire skill resilient.

3. **Auto-generation beats manual maintenance.** `generate-ref.sh` took 30 minutes to write and will save hours of debugging stale commands over the lifetime of the skill.

4. **Capability descriptions don't rot.** "List files in folders" will always be true for Drive, regardless of whether the subcommand is `ls`, `list`, or `files`. Describing *what* rather than *how* is inherently more stable.

5. **Guard rails belong in AGENTS.md, not just the system prompt.** The CLI Tool Hygiene rule existed but was invisible to this session until explicitly added to the persistent context file.
