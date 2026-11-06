# Runbook: install pi for `pmpmt` on the LAN server (2025-11-03)

Host `192.168.1.60` (`pmpmt-B550-AORUS-ELITE-V2`, Ubuntu 24.04.4). Installed version: **pi 1.4.0**
on **node v24.22.2**, pinned to match the laptop. Docker plays no part in any of this.

## What the host had before

- system `node v18.19.1` at `/usr/bin/node`, `npm 9.2.0`
- nvm at `~/.nvm` with only `v20.9.0`, and **no nvm block in `.bashrc` or `.profile`**, so login
  shells quietly used the system node 18
- no `~/.pi`, no `pi`

## Steps actually run (all as `pmpmt`)

Three traps worth remembering, each hit on the first attempt:

1. `sudo -iu pmpmt bash -lc 'export NVM_DIR=$HOME/.nvm …'` through SSH loses `HOME` in the nested
   quoting, so `nvm.sh` was sourced as `/nvm.sh`. Use a heredoc instead:
   `ssh lan-storage 'sudo -u pmpmt -H bash -s' <<'EOS' … EOS`.
2. Appending the PATH/nvm block to `.bashrc` changes nothing for login shells: Ubuntu's `.bashrc`
   returns early when the shell is non-interactive, so `bash -lc` never reaches the end of the
   file. The block belongs in `.profile` as well.
3. `nvm install` run with the caller's cwd inside another user's home prints
   `find: Failed to restore initial working directory` and can leave `node -v` on the old version.
   `cd /home/pmpmt` first.

```bash
# 1. node 24 through nvm
export NVM_DIR=/home/pmpmt/.nvm
. "$NVM_DIR/nvm.sh"
nvm install 24            # → v24.22.2
nvm alias default 24

# 2. pi, pinned
export PATH=/home/pmpmt/.nvm/versions/node/v24.22.2/bin:$PATH
npm i -g @earendil-works/pi-coding-agent@1.4.0
# → /home/pmpmt/.nvm/versions/node/v24.22.2/bin/pi, `pi --version` = 1.4.0

# 3. shell integration (appended to both .bashrc and .profile, backups kept as *.bak.<epoch>)
export PATH="$HOME/.local/bin:$PATH"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
```

## Launcher for non-interactive shells

`/home/pmpmt/.local/bin/pi`, mode 755 — for cron and `env -i` callers where nvm is never sourced:

```bash
#!/bin/bash
NODE_BIN="$HOME/.nvm/versions/node/v24.22.2/bin"
export PATH="$NODE_BIN:$PATH"
exec "$NODE_BIN/pi" "$@"
```

Bump `NODE_BIN` after a future `nvm install`; otherwise the wrapper pins a node that may be gone.

## Verification

```bash
ssh lan-storage 'sudo -u pmpmt -H bash -lc "node -v; npm prefix -g; command -v pi; pi --version"'
#  v24.22.2 / /home/pmpmt/.nvm/versions/node/v24.22.2 / …/bin/pi / 1.4.0

ssh lan-storage 'sudo -u pmpmt -H env -i HOME=/home/pmpmt PATH=/home/pmpmt/.local/bin:/usr/bin:/bin bash -c "pi --version"'
#  1.4.0  ← proves the wrapper does not depend on nvm being sourced
```

## Credentials: `.env` holds the keys, `auth.json` only points at them (2025-11-03)

Pi accepts a **command** as an API key when it is prefixed with `!` (see `docs/providers.md`,
"Load an API key from a command"): it runs the command on first use and caches stdout for the
process lifetime. That is the supported indirection, and it is what this host uses — no secret ever
lives in `auth.json`.

```
/home/pmpmt/.pi/agent/
  .env       600  pmpmt   DEEPSEEK_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY
  key        700  pmpmt   prints one named value from .env, exits non-zero if absent
  auth.json  600  pmpmt   { "deepseek": { "type": "api_key", "key": "!$HOME/.pi/agent/key DEEPSEEK_API_KEY" }, … }
```

The reader, because JSON cannot spell "read a variable":

```bash
#!/bin/bash
set -u
file="${PI_AGENT_ENV:-$HOME/.pi/agent/.env}"
[ -r "$file" ] || exit 1
value="$(awk -F= -v want="$1" '$1 == want { sub(/^[^=]*=/, ""); print; exit }' "$file")"
[ -n "$value" ] || { echo "key: $1 not found in $file" >&2; exit 1; }
printf '%s\n' "$value"
```

`$HOME` expands because pi runs the command through a shell — verified, not assumed: the first
`auth.json` written this way used `$HOME/…` and the call succeeded, which exec-without-shell would
not have. `PI_AGENT_ENV` allows pointing at a different env file without touching `auth.json`.

Keys were transferred by piping JSON from the laptop over SSH (`umask 077`) so no key appeared on a
command line. To rotate: edit `.env` only. To revoke a provider: delete its entry in `auth.json`.

## Verified end to end (2025-11-03, after the indirection)

```
pi --provider deepseek --model deepseek-flash -p "…"   → ENVREF_OK
pi --provider google   --model gemini-3.8-flash -p "…" → ENVREF_GOOGLE
pi --provider openai   --model gpt-6.1-sol     -p "…"  → ENVREF_OPENAI
```

## Still open

- No default model is pinned: `pi` with no flags falls back to its own default. Add
  `<agent-dir>/settings.json` (`defaultProvider`, `defaultModel`, `defaultThinkingLevel`,
  `defaultTools`) when the dedicated server agent is created.
- The TUI needs a terminal: `ssh -t lan-storage pi`.
- Nothing here uses Docker, per the standing decision.
