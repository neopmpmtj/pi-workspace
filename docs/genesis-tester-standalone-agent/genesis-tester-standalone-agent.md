# Standalone Pi Agent (`genesis-tester`) — Setup & Implementation Report

**Date:** 2026-10-03
**System:** Ubuntu 24.04.5 LTS (kernel 7.0.0-34-generic) · Pi v1.0.0 · Node v24.21.0
**Location:** `~/.pi/genesis-tester/` (workspace) · `~/.bashrc:139-145` (launcher) · `~/.pi/docs/genesis-tester-standalone-agent/` (this report)

---

## Problem

Every Pi identity on this machine inherited a large, opinionated configuration layer. `~/.pi/agent/` ships:

- an **Orchestrator** `AGENTS.md` ("delegate, don't execute"),
- an `APPEND_SYSTEM.md` (location context, secrets rule, CLI hygiene),
- 4 npm packages (`pi-web-access`, `pi-agent-browser-native`, `pi-agents-pool`, `@mjakl/pi-subagent`) that inject `web_search`, `agent_browser`, `subagent`/`spawn_agent` tools,
- 6 skills, custom prompts, and several custom extensions.

`~/.pi/explore-discover/` (the existing second instance, `pi-explore`) shares only the *credentials* — it carries its own `AGENTS.md`, tutor curriculum, prompts, and settings. There was no way to answer a simple question: **what does Pi behave like with a stock system prompt and no additions at all?**

The goal: a deliberately **bare, standalone identity** — `genesis-tester` — with:

- its own workspace and its own `.env` (independent of `~/.pi/agent/.env`),
- provider/model/thinking defaults so it can chat immediately,
- `auth.json` and `trust.json` so it starts without prompts or login,
- **no** `AGENTS.md`, **no** `APPEND_SYSTEM.md`, **no** prompts/skills/extensions, **no** packages,
- a shell launcher matching the existing `pi-explore()` pattern,
- explicitly **outside** the partner-agent framework (no registry entry), and **no `git init`**.

---

## Investigation / Root Cause

The request contained one incorrect variable name (`PI_CONFIG_AGENT_DIR`) and one incorrect assumption worth verifying: that Pi itself loads `.env` files. Both were resolved by reading the installed Pi v1.0.0 source and docs — not from memory.

### Variable names: derived, not fixed

`dist/config.js:434-436` derives all three names from the app name:

```js
export const ENV_AGENT_DIR   = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;   // PI_CODING_AGENT_DIR
export const ENV_SESSION_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_SESSION_DIR`;
```

| Claimed name | Reality |
|---|---|
| `PI_CONFIG_AGENT_DIR` | **Does not exist.** Correct name is `PI_CODING_AGENT_DIR`. |
| `PI_AGENT_SESSION_DIR` | **Does not exist.** Correct name is `PI_CODING_AGENT_SESSION_DIR`. |
| — | A code comment at `dist/config.js:434` names `TAU_CODING_AGENT_DIR` as a legacy alias. |

`getAgentDir()` returns the env value (tilde expanded) when set, else `~/.pi/agent`:

```js
export function getAgentDir() {
    const envDir = process.env[ENV_AGENT_DIR];
    if (envDir) return expandTildePath(envDir);
    return join(homedir(), CONFIG_DIR_NAME, "agent");
}
```

It is read **once at startup**, so it must be present in the launcher's environment before the `pi` process starts.

### Session storage is inherited, not configured

`dist/main.js:547-550` and `docs/settings.md:64` give the precedence chain:

```
--session-dir  >  PI_CODING_AGENT_SESSION_DIR  >  settings.json "sessionDir"  >  default
```

The default is derived from the agent dir (`dist/config.js:486`):

```js
export function getSessionsDir() { return join(getAgentDir(), "sessions"); }
```

**Consequence:** pointing `PI_CODING_AGENT_DIR` at the new workspace automatically isolates session history. No session variable was needed.

### Pi never reads `.env`

- `grep '"dotenv"' package.json` → **no such dependency**.
- `docs/environment-variables.md` documents no `.env` behaviour; `docs/configuration.md` lists no `.env` in the agent directory.

`.env` works in this setup **only because a shell wrapper sources it** — `~/.local/bin/pi` does so for the default identity, and each per-agent `.bashrc` function does so for its own. This means a standalone agent's `.env` is inert unless its launcher sources it.

### Credential resolution paths in v1.0.0

`docs/providers.md:73-80` documents exactly two mechanisms:

1. **`!`-prefixed command** — `"key": "!security find-generic-password -ws 'x'"`, run on first use and cached for the process lifetime.
2. **Real provider env vars** — `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, etc.

There is **no documented `$VAR` interpolation inside `auth.json`**. The standing claim in `~/.pi/agent/APPEND_SYSTEM.md` ("Pi resolves `$VAR` references in `auth.json` natively") is stale for v1.0.0. Since the launcher exports real env vars, that path works without any interpolation — so it did not block this setup.

### Baseline check: `gemini` reports `not_ready`

`pi auth check --provider gemini` returned `not_ready` for the new workspace. Running the identical check against `~/.pi/agent` returned `not_ready` **too**. Pre-existing provider/check condition, not a defect introduced here. `deepseek` (the default) returns `ready` in both.

---

## Architecture / Design Decisions

### Compared to the existing second instance

| Aspect | `explore-discover` (existing) | `genesis-tester` (new) |
|---|---|---|
| Purpose | Pi internals tutor | Bare-identity experiment |
| `AGENTS.md` | Custom tutor role + curriculum | **Absent** → stock coding-assistant prompt |
| `APPEND_SYSTEM.md` | Present | **Absent** |
| Credentials | `auth.json` + `models-store.json` **symlinks** → `~/.pi/agent/` | `auth.json` **copy**; `.env` **independent copy** |
| `.env` sourced | `~/.pi/agent/.env` | **own** `~/.pi/genesis-tester/.env` |
| Extensions/skills/prompts | Present | **None** |
| `settings.json` packages | `npm:pi-web-access` | **no `packages` key at all** |
| Git repo | Own repo `neopmpmtj/explore-discover` | Initially none (see *Subsequent Drift*) |
| Registry | In `partner-agents.list` | Deliberately **not** registered |

### Decisions and alternatives

| Decision | Chosen | Rejected alternative | Why |
|---|---|---|---|
| Config isolation | `PI_CODING_AGENT_DIR` | Separate Pi install | Zero-install; the variable switches the entire config surface at once. |
| Secrets | Copy `.env` + `auth.json` | Symlink to `~/.pi/agent/` | User asked for standalone; a copy survives changes to the main agent's env file. Trade-off accepted: **key rotation no longer propagates**. |
| System instruction | **None** (stock prompt) | Draft an `AGENTS.md` | The point of the experiment is stock behaviour with zero instruction injection. |
| Tool surface | Omit `packages` entirely | Explicit tool allowlist flags | Removing packages removes the tools *and* their system-prompt contributions — a cleaner bare baseline than `--tools`. |
| Session location | Inherit default | Set `PI_CODING_AGENT_SESSION_DIR` | Default already lands inside the workspace; one less moving part. |
| Registry | Skip `partner-agents.list` | Register it | Registry drives `push-partner-agents.sh`; the user wanted no git involvement. |
| `.gitignore` before git exists | Yes (6 lines) | Wait until `git init` | Protects `auth.json`/`.env` proactively rather than after the fact. **Vindicated** — a repo was created ~11 minutes later. |

### `settings.json` shape — deliberately minimal

```json
{
  "defaultProvider": "deepseek",
  "defaultModel": "deepseek-flash",
  "defaultThinkingLevel": "high",
  "theme": "dark"
}
```

No `packages`, no `enabledModels`, no `compaction`, no `trust`. Omission is the feature: the agent boots with the read/bash/edit/write toolset only.

---

## Implementation

### Phase 1 — Workspace and configuration files

```bash
AGT="$HOME/.pi/genesis-tester"; mkdir -p "$AGT"
umask 077    # .env + auth.json written 600 from the start
```

`.env` was built by **extracting only the three required keys** from `~/.pi/agent/.env` (values never echoed to the terminal or to logs):

```bash
for k in DEEPSEEK_API_KEY GEMINI_API_KEY OPENAI_API_KEY; do
  grep -E "^${k}=" "$HOME/.pi/agent/.env"
done > "$AGT/.env"
chmod 600 "$AGT/.env"
```

`auth.json` was copied and re-tightened (`cp` then `chmod 600`); `trust.json` mirrors the main agent; `.gitignore` was written before any repo existed.

Final files created by this session:

```json
{
  "defaultProvider": "deepseek",
  "defaultModel": "deepseek-flash",
  "defaultThinkingLevel": "high",
  "theme": "dark"
}
```

```
~/.pi/genesis-tester/
├── .env            600   3 keys: DEEPSEEK_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY
├── auth.json       600   copy of ~/.pi/agent/auth.json (deepseek + gemini, type=api_key)
├── settings.json   644   provider / model / thinking / theme — no "packages"
├── trust.json      644   {"\/home\/pmpmt\/.pi": true}
└── .gitignore      644   auth.json, .env, sessions/, npm/, *.log, models-store.json
```

### Phase 2 — Shell launcher

Appended to `~/.bashrc` (guarded against duplicate insertion, then syntax-checked with `bash -n`):

```bash
# Pi genesis-tester agent — standalone experiment, own .env, separate identity
pi-genesis-tester() {
    set -a
    source ~/.pi/genesis-tester/.env
    set +a
    PI_CODING_AGENT_DIR=~/.pi/genesis-tester command pi "$@"
}
```

Ordering matters: `set -a` + `source` must precede `command pi`, because Pi reads neither `.env` files nor the agent dir late. Hyphenated names are valid for bash functions.

### Phase 3 — Verification

| Check | Command | Result |
|---|---|---|
| Function loads from `.bashrc` | `bash -ic 'declare -f pi-genesis-tester'` | ✅ found |
| `PI_CODING_AGENT_DIR` actually honoured | observe files created by Pi | ✅ `models-store.json` written **inside** the new dir |
| Credential readiness | `pi-genesis-tester auth check --provider deepseek` | ✅ `ready` |
| Model resolution | `pi-genesis-tester --list-models deepseek` | ✅ `deepseek-flash`, `deepseek-v4-pro` |
| Real completion | `pi-genesis-tester --print "…"` | ✅ returned text |
| **Tool isolation** | asked the agent to list its tools | ✅ `read, bash, edit, write` — **no** `web_search`, `agent_browser`, `subagent` |
| Session location | `find ~/.pi/genesis-tester/sessions -type f` | ✅ `sessions/--home-pmpmt--/<ts>_<id>.jsonl` |
| Cross-contamination | `ls ~/.pi/agent/ \| grep -i genesis` | ✅ clean, both directions |

The probe session created during verification was deleted (`rm -rf ~/.pi/genesis-tester/sessions`).

**Note on session slugs:** the directory name is the working directory with `/` → `-`. The probe ran from `~`, producing `--home-pmpmt--`; later runs from inside the workspace produced `--home-pmpmt-.pi-genesis-tester--`.

### Phase 4 — Documentation upkeep

`~/.pi/docs/pi-state-summary.md` was updated in the same session (standing duty): new section **16. Standalone Agent — genesis-tester**, a Version Control row, and two Key Files rows.

---

## Subsequent Drift (observed, not performed by this session)

Between 17:54 and 18:42 the same day — i.e. **after** the setup above was verified — the workspace was changed by the user and by Pi sessions run inside it. Recorded here because it invalidates parts of the original design and matters for anyone reading this later.

| Time | Change | Effect |
|---|---|---|
| 17:54 | `~/.pi/.gitignore` line 57 → `genesis-tester/` under `# ── Nested repos ──` | Parent `pi-workspace` repo stops seeing the workspace |
| 17:57 | `git init` + `first commit` in the workspace | **"No git init" was later reversed by the user** |
| 18:01 | Session run from cwd `~/.pi/genesis-tester`; `bin/fd`, `bin/rg` copied in; full 76 KB `models-store.json` | Workspace gained ~8.8 MB of vendored binaries |
| 18:04–18:42 | 4 further commits, all touching `settings.json` (`lastChangelogVersion`) | Commit messages are LLM-generated |
| 18:09 | `extensions/pi-prompt-capture.ts` symlink added → `~/.pi/agent/skills/pi-prompt-dump/extensions/pi-prompt-capture.ts` | Workspace is **no longer extension-free** |
| 18:11 | Session run; `state/prompt-capture/{latest.json,<id>.json}` created | Captured system prompt on disk |

**Finding — session transcripts are tracked in git.** `.gitignore` was edited to comment out `sessions/` (`# sessions/`), and the first commit already contains:

```
.gitignore
bin/fd
bin/rg
extensions/pi-prompt-capture.ts
sessions/--home-pmpmt-.pi-genesis-tester--/…17-01-48….jsonl
sessions/--home-pmpmt-.pi-genesis-tester--/…17-11-01….jsonl
settings.json
state/prompt-capture/01a102bf-….json
state/prompt-capture/latest.json
trust.json
```

`git check-ignore -v sessions/` → not ignored; `.git/info/exclude` holds only comments. `auth.json` and `.env` **remain correctly ignored and untracked**.

**Containment:** `git remote -v` → **no remote**. Nothing has been published. The parent `~/.pi/.gitignore` also independently ignores `**/sessions/`, `**/.env`, `**/auth.json`, so `pi-workspace` is protected regardless.

**Authorship:** all commits are authored `Pedro Julio` (local git identity), so this is indistinguishable from user-driven work — but the commit subjects and the 41-minute spacing indicate they were produced with the agent.

---

## Files Created / Modified

### By this session

| Path | Approx. size | Action | Purpose |
|---|---|---|---|
| `~/.pi/genesis-tester/.env` | 7 lines, 600 | Created | Independent copy of 3 API keys |
| `~/.pi/genesis-tester/auth.json` | 9 lines, 600 | Created (copy) | Provider credentials for the isolated dir |
| `~/.pi/genesis-tester/settings.json` | 6 lines | Created | deepseek / deepseek-flash / high / dark; no packages |
| `~/.pi/genesis-tester/trust.json` | 3 lines | Created | Pre-grants trust for `~/.pi` |
| `~/.pi/genesis-tester/.gitignore` | 6 lines | Created (+1 appended) | Protects secrets/sessions before any repo existed |
| `~/.bashrc` | +8 lines (139-145) | Modified (append) | `pi-genesis-tester()` launcher |
| `~/.pi/docs/pi-state-summary.md` | +14 lines | Modified | §16, Version Control row, Key Files rows |
| — | — | Deleted | Verification probe session (`sessions/`) |

### By subsequent sessions / the user (this report's subject only as observation)

| Path | Action | Note |
|---|---|---|
| `~/.pi/genesis-tester/.git/` | Created | 5 commits, no remote, ~4.3 MB |
| `~/.pi/genesis-tester/bin/{fd,rg}` | Created | 8.8 MB vendored binaries, **committed** |
| `~/.pi/genesis-tester/extensions/pi-prompt-capture.ts` | Created | Symlink; breaks the "no extensions" premise |
| `~/.pi/genesis-tester/models-store.json` | Replaced | 2-byte stub → full 76 KB catalog (ignored) |
| `~/.pi/genesis-tester/sessions/**`, `state/**` | Created | **Tracked by git** |
| `~/.pi/genesis-tester/settings.json` | Modified | `+ "lastChangelogVersion": "1.0.0"` |
| `~/.pi/.gitignore` | Modified | Line 57: `genesis-tester/` |

---

## Open Items

1. **Secrets/session exposure in the nested repo.** `sessions/` and `state/prompt-capture/` are committed. Currently contained by the absence of a remote, but the next `git remote add` + `push` would publish full transcripts. Either restore `sessions/` to `.gitignore` or keep the repo permanently local.
2. **`APPEND_SYSTEM.md` stale claim.** It asserts Pi interpolates `$VAR` inside `auth.json`; v1.0.0 documents only `!command` and real env vars, and there is no dotenv dependency. Not corrected — flagged to the user for approval.
3. **Credential drift by design.** The `.env` and `auth.json` copies no longer track `~/.pi/agent/`; rotating a key in the canonical store leaves this agent stale.
4. **`bin/fd` + `bin/rg` (8.8 MB) are committed** to a repo that has no remote — pure ballast unless intentionally vendored.
5. **Second-instance reference is stale.** `~/.pi/docs/separate-pi-instances/separate-pi-instances.md` describes symlinked credentials and omits `genesis-tester`; updated alongside this report.

---

## Reproduction

```bash
# 1. Workspace
mkdir -p ~/.pi/<name> && umask 077
for k in DEEPSEEK_API_KEY GEMINI_API_KEY OPENAI_API_KEY; do
  grep -E "^${k}=" ~/.pi/agent/.env
done > ~/.pi/<name>/.env
chmod 600 ~/.pi/<name>/.env
cp ~/.pi/agent/auth.json ~/.pi/<name>/auth.json && chmod 600 ~/.pi/<name>/auth.json

# 2. settings.json (omit "packages" to strip web_search / agent_browser / subagent)
# 3. trust.json  →  {"\/home\/pmpmt\/.pi": true}
# 4. .gitignore  →  auth.json, .env, sessions/, npm/, *.log, models-store.json

# 5. Launcher (append to ~/.bashrc, then `source ~/.bashrc`)
pi-<name>() {
    set -a; source ~/.pi/<name>/.env; set +a
    PI_CODING_AGENT_DIR=~/.pi/<name> command pi "$@"
}

# 6. Verify
pi-<name> auth check --provider deepseek        # → ready
pi-<name> --list-models deepseek                # → deepseek-flash, deepseek-v4-pro
pi-<name> --print "List ONLY your tool names."  # → read, bash, edit, write
```

**Removal:** `rm -rf ~/.pi/<name>` and delete the `.bashrc` block. No registry entry, no service, no shared state.
