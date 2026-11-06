---
description: Dump the live system prompt (sections, AGENTS.md, APPEND_SYSTEM.md, injected blocks) verbatim into this chat
argument-hint: "[section,section | --list | --check | --exact]"
---
Reproduce the live pi system prompt for this session, verbatim, using the
`pi-prompt-dump` skill's deterministic engine. Do not paraphrase, summarise, or
reformat the content — paste it exactly as the script emits it.

Requested selection: `$@`

Steps:

1. If `$@` is empty, run:
   `node ~/.pi/agent/skills/pi-prompt-dump/scripts/dump.mjs --print`
2. If `$@` is `--list`, `--check`, `--exact`, or `--hash`, pass that flag through unchanged.
3. Otherwise treat `$@` as a comma-separated section list and run:
   `node ~/.pi/agent/skills/pi-prompt-dump/scripts/dump.mjs --print --parts="$@"`

Then paste the script's stdout into the chat inside a single fenced block.
If the output is long, paste all of it; do not truncate or elide any part.
Do not add commentary beyond one line naming the output path or flag used.

If the script exits non-zero, report the exact stderr instead of inventing content.
