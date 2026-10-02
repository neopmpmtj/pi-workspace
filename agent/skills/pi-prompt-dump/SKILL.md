---
name: pi-prompt-dump
description: Deterministically reproduce the live pi system prompt and every instruction file the agent receives — harness sections, AGENTS.md, APPEND_SYSTEM.md, skill list, subagent list, and extension-injected blocks. Use when asked to print, dump, show, or archive the agent's system prompt or instructions; when asked what the agent was told; when asked where a given instruction comes from; or when detecting and explaining what changed in the agent's instructions after an edit, upgrade, or config change. Zero LLM calls except the opt-in --triage diff explainer.
license: MIT
---

# pi-prompt-dump

Reproduce the exact instruction surface a pi agent receives, using code only.
No network, no model, no drift.

The only place an LLM is involved is `--triage`, which pipes a drift diff to
`pi --print` and asks what changed and whether it matters.

## Why this works at all

pi persists the system prompt into the session transcript as structured
`sections`, then replays that state on later runs. The transcript is therefore a
first-class, byte-faithful source of the prompt — not a copy someone typed.

Rendering mirrors pi-ai's own `getSystemMessageText()`:

```
[content, ...Object.values(sections).filter(v => v !== null)]
  .filter(p => p.length > 0)
  .join("\n\n")
```

Later system messages are PATCHES (`diffSystemPromptSections`): changed sections
carry new text, removed sections carry `null`. Plain key assignment reproduces
pi's merge semantics — updated keys keep position, new keys append.

## The one thing that is not in the transcript

Extensions that return a `systemPrompt` string from `before_agent_start` replace
the rendered prompt for that run, and per pi's docs the transcript "continues
recording the structured sections" — so the replacement is **not persisted**.

Concretely: `@mjakl/pi-subagent` appends a "## Available Subagents" block that
never appears in the transcript. `dump.mjs` therefore rebuilds it in code, from
the same discovery rules and a port of the extension's own wording (pinned to
`@mjakl/pi-subagent@3.0.1`). Those parts are labelled `reconstructed`.

For a byte-exact capture instead of a reconstruction, install the optional
capture extension (see below).

## Run it

```bash
S=~/.pi/agent/skills/pi-prompt-dump/scripts/dump.mjs

node $S --print            # annotated markdown dump (default)
node $S --exact            # raw concatenated prompt, no headers
node $S --list             # inventory: name, size, hash, origin, source
node $S --json             # machine-readable, with attribution
node $S --hash             # per-section + overall sha256
node $S --save <path>      # write the annotated dump to a file

node $S --baseline save    # snapshot the current prompt
node $S --check            # diff vs baseline; exit 1 on drift
node $S --triage           # one LLM call explaining the drift

node $S --parts=addendum,project_context    # only these sections
node $S --session <file.jsonl>              # explicit session
node $S --no-reconstruct                    # transcript sections only
node $S --no-redact                         # disable redaction
```

Prefer running it directly in a terminal: that costs zero tokens. Routing it
through the agent (`/dump`) puts the whole prompt into the conversation and
costs tokens, but is the way to see it in chat.

## Detecting and explaining drift

```bash
node $S --baseline save     # once, when the prompt is in a known-good state
# ...edit AGENTS.md, a SKILL.md, settings, or upgrade pi...
node $S --check             # unified diff per changed section, exit 1 on drift
node $S --triage            # optional: LLM explains the diff
```

`--check` compares raw text, so redaction can never mask a change.

Optional model override for triage:

```bash
PI_PROMPT_DUMP_TRIAGE_MODEL=deepseek-flash node $S --triage
```

## Optional: byte-exact capture

```bash
bash ~/.pi/agent/skills/pi-prompt-dump/scripts/install-capture-extension.sh
# then run /reload inside pi
```

Symlinks `extensions/pi-prompt-capture.ts` into `~/.pi/agent/extensions/`. It
observes `before_agent_start`, writes the final prompt to
`~/.pi/agent/state/prompt-capture/<session-id>.json`, and never mutates the
prompt. Remove with `rm ~/.pi/agent/extensions/pi-prompt-capture.ts`.

Caveat: extensions run in load order. If the capture handler runs before another
extension appends, the capture is partial — the record includes a `markers` map
and a `complete` flag so this is detectable rather than silently trusted.

## Files

```
SKILL.md
scripts/dump.mjs                 engine (transcript replay, modes, diff)
scripts/triage.sh                the single opt-in LLM call
scripts/parts.json               section -> origin map; edit this, not code
scripts/lib/frontmatter.mjs      dependency-free frontmatter reader
scripts/lib/subagent-block.mjs   ported subagent block builder
scripts/lib/redact.mjs           display-only secret scrubbing
scripts/install-capture-extension.sh
extensions/pi-prompt-capture.ts  optional byte-exact capture
baseline/                        created by --baseline save
```

## When pi changes its layout

1. `node $S --list` — see the section names and sizes the transcript now has.
2. Compare with `scripts/parts.json`; add any unmapped section (unmapped sections
   are reported as `unknown` and warned about, never dropped).
3. If a request-time injection appeared, add a builder under `scripts/lib/` and
   list it in `parts.json` under `runtimeInjections`.
4. Re-run `--baseline save`.

## Redaction

Display output is scrubbed for common credential shapes (provider keys, GitHub
tokens, JWTs, private keys, `SOMETHING_TOKEN=...` assignments). Secrets are
supposed to live in `~/.pi/agent/.env` and be referenced as `$VAR`, so matches
should be zero — a non-zero count in the header is itself a finding worth
investigating. Hashing, `--check`, and `--json` raw hashes always use unredacted
text.

## Limits

- `preamble`, `tools`, `rules`, `docs`, `skills`, and `cwd` are generated by pi
  core at runtime. The dump reports them exactly as delivered, but cannot tell
  you which source file produced an individual word.
- The reconstructed subagent block is a port, not the extension's own execution.
  If `@mjakl/pi-subagent` changes its wording, the port drifts. Use the capture
  extension plus `--triage` to catch it.
- A session started with `--no-session` has no transcript; only capture works.
