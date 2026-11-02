# Setting Up Session Memory on a New Pi Instance

You need two pieces: the **extension** (captures conversations) and the **summarizer** (turns them into AI summaries with markdown). They work independently.

---

## Piece 1: Extension (automatic data capture)

### 1. Copy the extension
```
cp session-memory.ts  <his-project>/.pi/extensions/session-memory.ts
```

### 2. Tell Pi where to save snapshots
Add this line to `~/.pi/agent/.env`:
```
PI_SESSION_SUMMARIES_PATH=/home/<user>/<project>/session-summaries
```
(Replace `/home/<user>/<project>` with the actual project path.)

If you skip this, it falls back to a relative path next to the extension — which works fine for most setups.

### 3. Reload Pi
Inside Pi: `/reload`

### 4. That's it
Every `/new`, `/fork`, or `quit` now saves a JSON snapshot to `session-summaries/`.

---

## Piece 2: Summarizer (on-demand AI summaries)

### 1. Copy the folder
```
cp -r session-summarizer/  <his-project>/session-summarizer/
```

### 2. Edit the config
Open `session-summarizer/summarizer-config.json` and change these three paths:
```json
"summariesPath": "/home/<user>/<project>/session-summaries",
"outputPath":    "/home/<user>/<project>/sessions-memory",
"envPath":       "/home/<user>/.pi/agent/.env"
```

### 3. Pick a provider (optional)
Set `"provider"` to one of: `deepseek`, `openai`, `anthropic`, `gemini`, `local`.
Make sure the corresponding API key exists in the `.env` file (e.g., `DEEPSEEK_API_KEY=sk-...`).

### 4. Run it
```bash
node session-summarizer/summarize.mjs
```
- Add `--dry-run` to preview without processing.
- Add `--force` to reprocess everything (ignores the state tracker).

### 5. Run the tests (optional, to verify everything works)
```bash
node --test session-summarizer/tests/summarize.test.mjs
```

---

## Quick Reference

| What | Where |
|---|---|
| Raw snapshots | `session-summaries/*.json` |
| AI summaries | `sessions-memory/*.summary.md` |
| State tracker | `session-summarizer/summarizer-state.json` |
| Config | `session-summarizer/summarizer-config.json` |
| Log | `session-summarizer/summarizer.log` |

---

## How It All Fits

```
/conversation happens in Pi/
        │
        ▼  /new, /fork, quit
[session-memory.ts] ──► session-summaries/2026-07-28_10-00-00_new.json
        │                        (summary: null)
        │
        ▼  node summarize.mjs
[session-summarizer] ──► sessions-memory/2026-07-28_10-00-00_new.summary.md
                             (YAML frontmatter + clean markdown)
```

Two independent steps. No AI during capture (fast, reliable). AI summaries on demand (flexible, switchable).
