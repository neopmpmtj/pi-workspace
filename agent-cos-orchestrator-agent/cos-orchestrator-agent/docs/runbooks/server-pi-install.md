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

## Not done, deliberately

- **No credentials.** `~/.pi/agent/` does not exist yet; it is created on first run. Until a provider
  key exists (or a local model is wired up), every prompt fails at the provider call.
- Options, in order of effort: copy `DEEPSEEK_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` into
  `/home/pmpmt/.pi/agent/.env` (mode 600) for API models; or wait for the RTX 3060 driver work and
  point pi at a local Ollama endpoint (`http://127.0.0.1:11434/v1`), which is the eventual plan.
- The TUI needs a terminal: run `ssh -t lan-storage pi` or a real session on the box. `pi -p "…"`
  works non-interactively once a model is configured.

## First run

```bash
ssh -t lan-storage pi          # interactive, after credentials exist
```
