# VPS agent parity: what `git pull` does not bring

Run this whenever the VPS (`neopmpmtj`, `100.85.79.17`) is said to be "synced with origin" but
something is missing. `~/.pi` on both hosts is the same private repo, but a third of what makes
an agent work lives **outside** the repo or is **gitignored** — those are exactly the files a
pull cannot supply.

## The split

| Kind | Where | In git? | Sync |
| --- | --- | --- | --- |
| Agent homes (instructions, scripts, contracts, docs) | `~/.pi/agent-*/…` | yes | `git -C ~/.pi pull --ff-only` |
| Launchers (`pi`, `pi-keep-agent`, …) | `~/.local/bin/` | **no** | copy by hand (below) |
| Provider keys | `~/.pi/agent-*/.env` | no (`.env` ignored) | copy on the host, from another `.env` already there |
| Model auth | `~/.pi/agent*/auth.json` | no | often `{}`; only copy when non-empty |
| Tool logins (keep, gog) | `~/.config/keep-cli/`, `~/.config/gogcli/` | no | copy over `ssh` (secrets) |
| `node_modules`, ledgers, sessions, caches | inside homes | no | rebuild: `npm install`, timers |
| systemd user units (dashboards, ledger timer, agent service) | `~/.config/systemd/user/` | no | reinstall per agent |

## Procedure

```bash
# 1. Repo
ssh neopmpmtj 'cd ~/.pi && git pull --ff-only && git log --oneline -1'

# 2. Launchers: diff both sides, copy what is missing AND whose home exists on the VPS
ls -1 ~/.local/bin | grep -E '^pi' | sort > /tmp/laptop_pi.txt
ssh neopmpmtj 'ls -1 ~/.local/bin | grep -E "^pi" | sort' > /tmp/vps_pi.txt
diff /tmp/laptop_pi.txt /tmp/vps_pi.txt          # '<' = missing on the VPS
ssh neopmpmtj 'cat > ~/.local/bin/pi-keep-agent && chmod +x ~/.local/bin/pi-keep-agent' \
  < ~/.local/bin/pi-keep-agent
md5sum ~/.local/bin/pi-keep-agent                 # must match both hosts

# 3. Env: never transfer keys over the wire when the VPS already has them.
#    Build the agent's .env from an .env already on that host.
ssh neopmpmtj 'src=~/.pi/agent-cos-orchestrator-agent/.env; dst=~/.pi/agent-keep-agent/.env; \
  umask 077; { grep -E "^(DEEPSEEK_API_KEY|GEMINI_API_KEY|OPENAI_API_KEY)=" $src; \
  echo DASHBOARD_PORT=8788; echo DASHBOARD_ORIGIN=http://127.0.0.1:8788; \
  grep -E "^(GOG_ACCOUNT|GOG_KEYRING_PASSWORD)=" ~/.pi/agent/.env; } > $dst; chmod 600 $dst'

# 4. Tool logins: keep-cli needs its credentials file (secret; streams over the SSH channel)
ssh neopmpmtj 'umask 077; mkdir -p ~/.config/keep-cli && cat > ~/.config/keep-cli/credentials.json' \
  < ~/.config/keep-cli/credentials.json

# 5. Command symlink (the script comes from git, the command does not)
ssh neopmpmtj 'ln -sfn ~/.pi/agent-keep-agent/keep-agent/scripts/keep_cli.py ~/.local/bin/keep-cli'

# 6. Verify with the PATH the agent actually has, not the bare ssh PATH
ssh neopmpmtj 'pid=$(pgrep -u $USER -f "^pi$" | head -1); \
  agentpath=$(tr "\0" "\n" < /proc/$pid/environ | grep -m1 "^PATH=" | cut -d= -f2-); \
  env -i HOME=$HOME PATH="$agentpath" bash -c "command -v keep-cli && keep-cli --count"'
```

A non-interactive `ssh` shell has a minimal PATH that excludes `~/.local/bin`, so
`keep-cli: command not found` there proves nothing. The supervisor starts pi with
`bash -lc`, so the agent's own bash **does** see `~/.local/bin`. Check `/proc/<pid>/environ`
before believing a PATH failure.

## State after 2026-11-06 (what was actually fixed)

| Item | Result |
| --- | --- |
| `keep_cli.py` on the VPS | present via git (commit `7a6c06d`), mode 755 |
| `~/.local/bin/keep-cli` | created (symlink) |
| `~/.config/keep-cli/credentials.json` | copied, mode 600, account `neopmpmtj@gmail.com` |
| `~/.local/bin/pi-keep-agent` | copied, md5 identical to the laptop's |
| `~/.pi/agent-keep-agent/.env` | created on the host from its own `.env` files; **no** Telegram token |
| `keep-cli --self-test` on the VPS | 29/29 |
| `pi-keep-agent -p "keep-cli --count"` on the VPS | answered 3 live entries |
| `agent-lan-agent`, `explore-discover-pi` homes | **deliberately not on the VPS** (user, 2026-11-06) — their launchers must not be copied either |
| keep-agent dashboard / ledger units | not installed there |

## Two units, one bot — the topology that actually exists (2026-11-06)

I first read this host as "one stale unit plus an unsupervised orphan". That was wrong, and the
correction matters because acting on the wrong reading briefly created a duplicate poller.

| Unit | Socket | ExecStart | State |
| --- | --- | --- | --- |
| `pi-cos.service` — "chief of staff (Telegram bridge)" | `-L pi-cos` | `~/pi-service/pi-cos-supervisor.sh` → `~/.local/bin/pi-cos-orchestrator-agent` | **enabled + active**, the real owner since 2026-11-05 |
| `pi-agent.service` — legacy "Pi coding agent" | `-L pi` | `~/pi-service/pi-supervisor.sh` → `~/.local/bin/pi` (no `PI_CODING_AGENT_DIR` → old harness home `~/.pi/agent/`) | `disabled` + `inactive`, keep it that way |

`pi-cos-supervisor.sh` also encodes two hard-won behaviours: it waits for the previous CoS pi to
finish its shutdown push before starting a new one (otherwise the Telegram transport lock goes
stale and the bridge refuses to connect), and it sends `/telegram-connect` if the pane still says
"telegram disconnected" after start.

### The 45-second incident

Because `pi-agent.service` looked like "the" unit and its `pi` process was running unsupervised,
it was repointed at the CoS launcher and enabled. But the process already running was
`pi-cos`'s own agent: socket `-L pi-cos` was invisible to `tmux -L pi ls`, and `pi-agent` had no
tmux server at all. Result: two CoS agents on one bot — the new one won polling and printed
`telegram connected`, the older `pi-cos` one printed `telegram disconnected`, and
`pi-cos-supervisor.sh` logged `previous instance still running after 40s — starting anyway`.

Resolved the same way it broke: `systemctl --user stop && disable pi-agent.service`, restore
`~/pi-service/pi-supervisor.sh` from `~/pi-service/pi-supervisor.sh.bak-20261106-1302`, and the
surviving `pi-cos` agent reclaimed the bot automatically. Verified after: one `pi` process
(`PI_CODING_AGENT_DIR=…cos-orchestrator-agent`), one tmux socket (`pi-cos`), one session,
`telegram connected`, `pi-cos.service` `NRestarts=0`.

Also done: `TELEGRAM_BOT_TOKEN` removed from `~/.pi/agent/.env` (backup
`.env.bak-20261106-1309`), so the legacy home cannot poll even if something starts it — the
token now exists only in `~/.pi/agent-cos-orchestrator-agent/.env`.

### Reading this host without being fooled again

- `systemctl --user list-units --all | grep -i pi` — list the units before believing one is
  "the" unit.
- `ls /tmp/tmux-1000/` — every socket, not just `-L pi`.
- `for p in $(pgrep -x pi); do tr '\0' '\n' < /proc/$p/environ | grep PI_CODING_AGENT_DIR; done`
  — which home each pi is actually running.
- `tmux -L <socket> capture-pane -p -t <session> | grep telegram` — the only reliable bridge
  status; the journal shows nothing because the supervisor runs pi inside tmux.
