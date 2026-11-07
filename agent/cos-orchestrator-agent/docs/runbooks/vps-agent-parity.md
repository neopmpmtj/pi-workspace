# VPS agent parity: what `git pull` does not bring

Run this whenever the VPS (`neopmpmtj`, `100.85.79.17`) is said to be "synced with origin" but
something is missing. `~/.pi` on both hosts is the same private repo, but a third of what makes
an agent work lives **outside** the repo or is **gitignored** — those are exactly the files a
pull cannot supply.

## The split

| Kind | Where | In git? | Sync |
| --- | --- | --- | --- |
| Agent homes (instructions, scripts, contracts, docs) | `~/.pi/agent-*/…` | yes | `git -C ~/.pi pull --ff-only` |
| Launchers (`pi`, `pi-tasks-agent`, …) | `~/.local/bin/` | **no** | copy by hand (below) |
| Provider keys | `~/.pi/agent-*/.env` | no (`.env` ignored) | copy on the host, from another `.env` already there |
| Model auth | `~/.pi/agent*/auth.json` | no | often `{}`; only copy when non-empty |
| Tool logins (gog) | `~/.config/gogcli/` | no | copy over `ssh` (secrets) |
| `node_modules`, ledgers, sessions, caches | inside homes | no | rebuild: `npm install`, timers |
| systemd user units (dashboards, ledger timer, agent service) | `~/.config/systemd/user/` | no | reinstall per agent |

## Procedure

keep-agent and keep-cli were removed on 2026-11-07 and must not be copied back. That includes `pi-keep-agent`, `keep-cli`, `~/.config/keep-cli`, and `~/.pi/agent-keep-agent/.env`.

```bash
# 1. Repo
ssh neopmpmtj 'cd ~/.pi && git pull --ff-only && git log --oneline -1'

# 2. Launchers: diff both sides. Copy a missing launcher only when that agent's home
#    exists on the VPS. Do not copy pi-keep-agent.
ls -1 ~/.local/bin | grep -E '^pi' | sort > /tmp/laptop_pi.txt
ssh neopmpmtj 'ls -1 ~/.local/bin | grep -E "^pi" | sort' > /tmp/vps_pi.txt
diff /tmp/laptop_pi.txt /tmp/vps_pi.txt          # '<' = missing on the VPS

# 3. Env: never transfer keys over the wire when the VPS already has them.
#    Build a live agent's .env from an .env already on that host.
#    Do not recreate ~/.pi/agent-keep-agent/.env.
```

A non-interactive `ssh` shell has a minimal PATH that excludes `~/.local/bin`, so
`command not found` there for a launcher under `~/.local/bin` proves nothing. The supervisor starts pi with
`bash -lc`, so the agent's own bash **does** see `~/.local/bin`. Check `/proc/<pid>/environ`
before believing a PATH failure.

## State after 2026-11-06 (what was actually fixed)

Removed 2026-11-07. Do not restore. The keep-agent rows record what was installed that day. The launcher, symlink, credentials, and `.env` were deleted on both hosts on 2026-11-07. Still current: `agent-lan-agent` and `explore-discover-pi` stay off the VPS, and their launchers must not be copied either.

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
| `pi-cos.service` — "chief of staff (Telegram bridge)" | `-L pi-cos` | `~/pi-service/pi-cos-supervisor.sh` → `~/.local/bin/pi` | **enabled + active**, the real owner since 2026-11-05 |
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
token now exists only in `~/.pi/agent/.env`.

### Reading this host without being fooled again

- `systemctl --user list-units --all | grep -i pi` — list the units before believing one is
  "the" unit.
- `ls /tmp/tmux-1000/` — every socket, not just `-L pi`.
- `for p in $(pgrep -x pi); do tr '\0' '\n' < /proc/$p/environ | grep PI_CODING_AGENT_DIR; done`
  — which home each pi is actually running.
- `tmux -L <socket> capture-pane -p -t <session> | grep telegram` — the only reliable bridge
  status; the journal shows nothing because the supervisor runs pi inside tmux.
