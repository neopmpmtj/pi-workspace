# gog token keepalive — one probe, two hosts

Read-only daily check that the `gog` OAuth token still works. An expired or revoked Google
token fails silently until a human needs it, so each host runs one authenticated read at
**08:00 Europe/Lisbon** and records it.

Script (the only tracked artifact): `cos-orchestrator-agent/scripts/gog-token-keepalive.sh`

```
~/.config/systemd/user/gog-token-keepalive.timer   OnCalendar=*-*-* 08:00:00 Europe/Lisbon
└── gog-token-keepalive.service                    Type=oneshot
    └── scripts/gog-token-keepalive.sh             gog drive ls -> exit 0/1/2
        ├── ~/.pi/agent/logs/gog-token-keepalive.log     plain text, one line per run
        ├── ~/.pi/agent/logs/gog-token-keepalive.jsonl   run ledger (JSONL)
        └── ~/.pi/agent/logs/gog-token-keepalive.streak  consecutive failures
```

Both hosts run the same script; only the alarm target differs.

| | laptop `pmpmt-ThinkPad-T15-Gen-2i` | VPS `neopmpmtj` |
|---|---|---|
| gog binary | `~/.local/bin/gog` | `~/.pi/agent/bin/gog` (not on `PATH`) |
| gog credentials | `~/.pi/agent/.env` (this host's own file) | `~/.pi/agent/.env` (legacy default-home file) |
| alarm on failure | journal only — no bot token here | Telegram to `allowedUserId` in the agent home `telegram.json` |
| units installed since | 2026-11-06 | 2026-11-06 (was `203/EXEC` daily since 2026-11-02) |
| replaced the Pi cron job | `cron-mrvwkizj-wiulnr` | `cron-mus46gbj-64pyqx` |
| `Persistent=true` | yes, but `Linger=no` → a missed run replays at next login | yes, `linger=yes` → replays at boot |

## Why not the Pi cron job it replaced

Pi cron timers live inside the pi process, so the job only fired if pi happened to be open at
08:00; its run status tracked the model turn rather than the command; and it could deliver
nothing but a log. `Persistent=true` also replays a run after downtime, which in-session cron
cannot do — `recomputeAllNextRuns()` only ever writes the next *future* occurrence.

## Install (either host)

The unit files are machine-local (`~/.config/systemd/user/`) and are **not** tracked in the repo.
Create them from the two blocks below, or copy them from the other host, then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now gog-token-keepalive.timer
systemctl --user list-timers gog-token-keepalive.timer --no-pager
```

The only per-host difference is `Description`, which says where alarms go.

```ini
# gog-token-keepalive.service   (laptop variant; VPS identical except the Description)
[Unit]
Description=Gog auth health probe (daily; alerts to the journal on this host)
Documentation=file:///home/pmpmt/.pi/agent/cos-orchestrator-agent/scripts/gog-token-keepalive.sh

[Service]
Type=oneshot
ExecStart=/home/pmpmt/.pi/agent/cos-orchestrator-agent/scripts/gog-token-keepalive.sh
# No StandardOutput/StandardError override on purpose: an append: target bypasses journald and
# grows unmanaged. The script keeps its own log and ledger either way.
TimeoutStartSec=180
```

```ini
# gog-token-keepalive.timer   (identical on both hosts)
[Unit]
Description=Daily gog auth health probe (08:00 Europe/Lisbon)

[Timer]
OnCalendar=*-*-* 08:00:00 Europe/Lisbon
Persistent=true
Unit=gog-token-keepalive.service

[Install]
WantedBy=timers.target
```

## Verify, or run it now

```bash
systemctl --user start gog-token-keepalive.service
systemctl --user show gog-token-keepalive.service -p Result -p ExecMainStatus   # success / 0
journalctl --user -u gog-token-keepalive -n 20 --no-pager                      # OK: auth healthy (probe ~500ms)
tail -2 ~/.pi/agent/logs/gog-token-keepalive.log
~/.pi/agent/cos-orchestrator-agent/scripts/gog-token-keepalive.sh --dry-run    # probe, print any alarm, send nothing
```

## Uninstall

```bash
systemctl --user disable --now gog-token-keepalive.timer
rm ~/.config/systemd/user/gog-token-keepalive.{service,timer}
systemctl --user daemon-reload
```

## Two traps this script already hit

1. **Never source an env file.** `~/.pi/agent/.env` holds `POSTGRES_CENTCOMPRAS_HASH`, which
   begins with `$4$`; `. "$file"` under `set -u` aborts the script with `line N: $4: unbound
   variable` — and if stderr is redirected, the failure looks like a silent `exit 1`. The script
   parses `KEY=value` lines as data instead.
2. **Do not pipe the probe into `head`.** With `pipefail` off (or `head` closing early) `$?`
   becomes SIGPIPE (`141`) and a healthy token reads as a failure. The script captures output.

Exit codes: `0` healthy · `1` probe failed · `2` misconfigured (no binary, or no
`GOG_ACCOUNT`/`GOG_KEYRING_PASSWORD`). A `2` is not a Google problem — check the env file first.
