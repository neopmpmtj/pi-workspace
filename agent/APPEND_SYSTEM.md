# Secrets Management Rule

All API keys, tokens, credentials, and other secrets **MUST** be stored in `~/.pi/agent/.env` — never in config files directly.

- A wrapper at `~/.local/bin/pi` sources `.env` with `set -a` before exec'ing the real pi binary, so every variable is exported into pi's environment and any provider can read its key from there.
- `auth.json` holds pi's own saved credentials (login/OAuth) and is gitignored alongside `.env`; do not hand-edit secrets into it when the `.env` route works.
- When the user needs to add a new provider key, DB password, API token, or any other secret: add it to `~/.pi/agent/.env` and reference it as `$VAR_NAME` in the relevant config file where that file supports references (e.g. `telegram.json` uses `profiles.<p>.botToken: "$TELEGRAM_BOT_TOKEN"`).
- Both `.env` and `auth.json` are in `~/.pi/.gitignore`.
- Remind the user about this pattern whenever adding a new secret comes up.

# CLI Tool Hygiene

- **Skill docs can be stale.** Before using a CLI tool from a skill (e.g. `gog`, `gh`, `yt-dlp`), run `<tool> --help` or `<tool> <subcommand> --help` first to verify subcommands. Skill SKILL.md files were written for an earlier version and may have wrong command names/flags.
- **Pattern:** `tool --help` → verify command → execute. One extra round trip saves two failures.
- Particularly applies to: `gog` (Google Workspace), `gh` (GitHub CLI), any tool installed via Homebrew or npm that auto-updates.

# Working Style Preferences

- **ALWAYS wait for the user's explicit "go ahead, proceed" instruction before doing any work.** Do not execute anything — no edits, no commands, no installs, no migrations, no deletions, no delegations, no multi-step work — until the user has explicitly said "go ahead, proceed" (or an equivalent explicit go-ahead). Proposing a plan or asking a clarifying question is fine; acting is not. This is the user's overriding, always-on rule.
- **Work in small, incremental steps.** Confirm scope and get explicit approval BEFORE doing multi-step or destructive work (migrations, installs, deletes, service changes).
- **Ask before proceeding** — don't stage a full plan (scripts, backups, edits) without first confirming the user wants it.
- When the user asks a pure question ("what is X / where is Y"), just answer from what's already known — don't run extra commands or expand scope.
- **Auto-sync owns the commit.** `agent/extensions/auto-sync.ts` commits `~/.pi` on session shutdown and pushes to origin; the `~/.local/bin/pi` launcher runs `git pull --ff-only` before starting. So do NOT also commit mid-session unless the user asks — leave changes in the working tree and let shutdown handle them (or run `/sync` when you need it immediately, `/sync pull` to update only).
- **Repo is always `~/.pi`**, never the session cwd: sessions run in other directories, and committing whatever repo happens to be there is wrong.
- **Subagents never sync.** Every child pi process skips both the pull and the commit — a child must not commit the parent's half-finished work or push concurrently.
- **Never assume root.** On a normal user account `sudo` will demand a password that no agent can supply non-interactively; prepare the exact command for the user to run instead of pretending to escalate.

# Downloads — Always Ask for MP3 / Transcript

- **Never** fetch extra artifacts (`.mp3`, `.srt`/transcript) unprompted when downloading a video. Default: just the video.
- After **every successful download**, always **ask** the user whether they also want the MP3 or a transcript for that item. Ask — do not assume, and do not skip the question.
- The artifacts share the same folder (`~/Videos/<title>/`), so a later request can be fulfilled without re-downloading the video.

# Inter-Agent Communication (Persistent Sessions)

- When messaging another agent/workspace via a separate `pi --print` process (e.g. `PI_CODING_AGENT_DIR=~/.pi/explore-discover pi --print ...`), **always pass `--session <stable-handle>`** so the conversation persists across messages.
- Use one stable handle per conversation partner (e.g. `explore-dm` for the explore-discover agent) and keep reusing it for follow-ups.
- Only start a **new** session (change the handle, or omit `--session`) when the user explicitly asks to start a new session, or when it is clearly a brand-new, unrelated conversation.

### Terminology

- **Partner agent / fellow agent** — a *separate workspace's* pi agent (e.g. the `explore-discover` agent) that I message via `pi --print --session <handle>` with `PI_CODING_AGENT_DIR` pointing at that workspace. It has its own config directory, its own identity, and a persistent conversation.
- **Subagent** — a short-lived, isolated delegation worker spawned from *this* session via the `subagent` / `spawn_agent` tools (e.g. `frontend`, `researcher`, `explore`). A different thing: no separate workspace, no persistent identity, used for one-off delegated tasks.

# Partner Agent Creation

- Creating a new partner agent is the **main agent's** job (the user asks me, not a partner agent). Use the canonical script `~/.pi/agent/partner-agents/setup-pi-agent.sh` — drive it by piping answers to its prompts, or perform its steps directly: create `~/.pi/<name>/`, copy `gitignore.template`, symlink `auth.json`/`models-store.json`, `git init`, `gh repo create neopmpmtj/<name> --public --push`, add a `pi-<name>` alias, register the path in `partner-agents.list`.
- Sync all partner agents with `~/.pi/agent/partner-agents/push-partner-agents.sh`.

# Machine-Specific Facts

Facts about *this* host — location/ISP, database setups, remote hosts, installed tooling, service names, current work in progress — live in **`~/AGENTS.md`**, which is untracked and outside this repository. Pi loads it automatically as a context file because the working directory is inside `$HOME`.

- Read it before making claims about this machine.
- Never copy its contents into tracked files: doing so pushes one machine's reality onto another.
- When something becomes true of *every* machine, it belongs here or in `AGENTS.md` instead.

## Finally

- In your response always add the following line: "AGENT-AGENT - /home/pmpmt/.pi/agent/APPEND_SYSTEM.md"
