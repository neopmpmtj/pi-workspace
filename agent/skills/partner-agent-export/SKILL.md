---
name: partner-agent-export
description: Export a developed/tuned partner agent as a self-contained installer (install-<name>.sh) that rebuilds it on any Pi instance, and import such an installer on a target Pi. Use when asked to export/copy/package a partner agent, ship an agent to another VPS/client, or install a partner agent from an install-<name>.sh file. Mirrors the Grok "share a Bot" model: ships the recipe (identity, instructions, skills, extensions, prompts, config) and NEVER secrets, history, or logins.
---

# Partner Agent Export / Import

Package a fully-tuned partner agent into ONE self-contained file and reproduce it on
any Pi. This is the same idea as Grok's "share a Bot" and
[portable-agent-kit](https://github.com/crab-xieyujin/portable-agent-kit): a
**recipe, not a meal** — what makes the agent *it* travels; keys, history and logins
stay behind and are re-linked on the target.

## When to use

- "export <name>" / "package <name>" / "give me an installer for <name>"
- "import <install-<name>.sh>" on a target machine
- Anything about shipping/copying an agent to another VPS or client

## Prerequisites

- `jq` and `bash` on the **exporting** machine (jq is only needed by the exporter,
  never by the installer).
- The target Pi already has its own credentials set up (`~/.pi/agent/auth.json`,
  `~/.pi/agent/models-store.json`, `~/.pi/agent/.env`). The installer **links** those;
  it never ships them.

## Export a partner agent (`/export <name>`)

1. Run the generator:
   ```bash
   bash ~/.pi/agent/partner-agents/export-partner-agent.sh <name>
   ```
   It resolves the agent by name: `~/.pi/partner-agents/<name>` first, then
   `~/.pi/<name>` (e.g. `explore-discover` lives at `~/.pi/explore-discover`).
   You may pass an explicit path as a second argument.

2. Output lands at:
   `~/.pi/agent/partner-agents/exports/<name>/install-<name>.sh`

3. Read the "Recipe manifest" the script prints, confirm nothing secret is listed,
   then hand the single `.sh` to the target (scp, git, whatever).

### Recipe manifest — what ships vs. never ships

Ships (the agent's identity + knowledge):
`AGENTS.md`, `APPEND_SYSTEM.md`, `.gitignore`, `web-search.json` (keys stripped),
`prompts/`, `documented_lessons/`, `session-summarizer/` (code only, no state),
`.pi/extensions/` (minus `*.log`, `*.old`, `*.jsonl`, `*-state.json`),
plus a regenerated `settings.json` (provider/model/thinking/theme/packages).

Never ships (target-side only, always excluded/regenerated):
`auth.json`, `models-store.json`, `.env`, `sessions/`, `session-summaries/`,
`sessions-memory/`, `npm/`, `bin/`, `.git`, `observability/`, `trust.json`,
`*.log`, `*-state.json`.

### Path portability

Absolute paths in shipped text files are made portable at export time:
- the source agent dir → `@@AGENT_DIR@@`
- the source `$HOME` → `@@PI_HOME@@`

The installer rewrites these to the target's actual install dir and `$HOME`. This
keeps `session-summarizer/summarizer-config.json` (`summariesPath`, `outputPath`,
`envPath`) and any self-references in `AGENTS.md`/lessons correct on the new machine.

## Import an installer (`/import <install-<name>.sh>`)

On the target Pi, run the file (it is idempotent):

```bash
bash install-<name>.sh          # or: SKIP_SMOKE=1 bash install-<name>.sh
```

The installer:
1. unpacks the recipe into `~/.pi/partner-agents/<name>/`
2. rewrites embedded paths to the target
3. symlinks `auth.json` + `models-store.json` → `~/.pi/agent/` (target's keys)
4. writes `trust.json` and `settings.json`
5. `pi install`s the agent's packages into that workspace
   (`PI_CODING_AGENT_DIR=$TARGET`)
6. registers the path in `~/.pi/agent/partner-agents/partner-agents.list`
7. adds a `pi-<name>` alias to `~/.bashrc`
8. runs a smoke test (`pi --print --session <name>-smoke …`)

After it finishes, verify and report to the user:
- `pi list` inside the new workspace shows the packages
- the smoke test answered with the agent's name/role
- `source ~/.bashrc` then `pi-<name>` opens a session

## Talking to a partner agent (reminder)

Persistent inter-agent messaging:
```bash
PI_CODING_AGENT_DIR=~/.pi/partner-agents/<name> pi --print --session <stable-handle> "..."
```
Use ONE stable handle per conversation partner and keep reusing it.

## Verification checklist (always do these before handing over)

- [ ] `bash -n` on the generated installer passes (the exporter already runs this)
- [ ] the printed recipe manifest contains no `auth.json`, `.env`, `sessions/`, `npm/`
- [ ] no secret patterns (`sk-…`, `ghp_…`, `AIza…`, `PRIVATE KEY`) in the shipped files
- [ ] the agent's `settings.json` model is valid on the target (adjust `DEF_MODEL` /
      note it to the user if the target lacks it)
- [ ] re-run the installer on a clean temp `$HOME` once if you want a hard guarantee

## Notes / gotchas

- `pi install` inside the installer uses the network; targets are assumed online.
- The generated installer is bash-only and self-contained (base64 tarball inside).
- If an agent's `settings.json` later grows fields beyond provider/model/thinking/
  theme/packages, extend the exporter's jq block to carry them over.
