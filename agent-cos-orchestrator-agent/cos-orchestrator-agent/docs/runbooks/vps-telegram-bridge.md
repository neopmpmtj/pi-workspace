# VPS Telegram bridge — diagnosis and repair

Host: `neopmpmtj` (`100.85.79.17`), bot **@pi_vps_assistant_bot** (`id 8968457121`).
Symptom: phone messages get no answer. Bot is healthy; the bridge is not.

## How the VPS agent is wired

```
pi-cos.service (user unit, WantedBy=default.target, enabled, linger=yes)
└── ~/pi-service/pi-cos-supervisor.sh        keeps one pi alive in tmux -L pi-cos
    └── tmux -L pi-cos  session "pi-cos"
        └── ~/.local/bin/pi-cos-orchestrator-agent
            ├── sources ~/.pi/agent-cos-orchestrator-agent/.env   (TELEGRAM_BOT_TOKEN)
            └── PI_CODING_AGENT_DIR=~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent
                ├── settings.json   -> packages: npm:@llblab/pi-telegram
                └── telegram.json    -> { "botToken": "$TELEGRAM_BOT_TOKEN", "allowedUserId": 6363173838 }
```

`pi-telegram` reads `telegram.json` **from `$PI_CODING_AGENT_DIR`**. A missing file is not
fatal: pi starts normally and the status line just says `telegram disconnected`.

## What broke on 2026-11-04 (and why)

1. On 2026-11-02 17:48 the CoS home moved from `~/.pi/cos-orchestrator-agent/cos-orchestrator-agent`
   to `~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent`, and the launcher was updated.
   The pi process started at 10:02 kept the **legacy** `PI_CODING_AGENT_DIR`, so nothing restarted it.
2. The legacy home had **no `telegram.json`** → `telegram disconnected` for 2 days.
3. `pi-cos-supervisor.sh` still had `AGENT_DIR` = the legacy path, so its "wait for the previous
   pi to exit" guard looked for the wrong process.
4. `pi-agent.service` (the old main-agent unit, socket `pi`, old home `~/.pi/agent`) was stopped and
   disabled on 2026-11-02 09:43 and no longer relevant. Both units point at the **same bot token**:
   **never run them at the same time** — two pollers fight over `getUpdates`.

## Diagnose in 5 commands (run on the VPS)

```bash
# 1. is the unit up, and is a pi alive inside tmux?
systemctl --user is-active pi-cos.service; tmux -L pi-cos ls
systemctl --user list-units --all --no-pager | grep -i 'pi-'   # catches a second poller

# 2. which home is the live pi using?
for p in $(pgrep -x pi); do tr '\0' '\n' < /proc/$p/environ | grep PI_CODING_AGENT_DIR; done

# 3. what does the status line say?
tmux -L pi-cos capture-pane -p -t pi-cos | tail -3      # expect "telegram connected"

# 4. is the token valid from this host, and is anyone polling?
set -a; . ~/.pi/agent-cos-orchestrator-agent/.env; set +a
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe"
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"   # pending_update_count, url must be ""

# 5. what did the bridge decide?
tail -3 ~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent/tmp/pi-telegram/logs.jsonl
```

`"Initialized Telegram cursor without executing history"` with a `lastUpdateId` means the bridge
**deliberately skipped** the queued backlog on startup — old messages are dropped, not replayed.
That is by design, so a queued "help" will never be answered; send a fresh message to test.

## Repair

```bash
# telegram.json must exist in the home the launcher actually sets
cp ~/.pi/agent/telegram.json ~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent/telegram.json
chmod 600 ~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent/telegram.json

# supervisor must watch the current home, not the legacy one
sed -i 's|AGENT_DIR="$HOME/.pi/cos-orchestrator-agent/cos-orchestrator-agent"|AGENT_DIR="$HOME/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent"|' \
  ~/pi-service/pi-cos-supervisor.sh

systemctl --user daemon-reload
systemctl --user enable pi-cos.service
systemctl --user restart pi-cos.service
sleep 25
systemctl --user is-active pi-cos.service
for p in $(pgrep -x pi); do tr '\0' '\n' < /proc/$p/environ | grep PI_CODING_AGENT_DIR; done
tmux -L pi-cos capture-pane -p -t pi-cos | tail -3     # "telegram connected"
```

End-to-end check: send a message from the phone. It is answered only if the bridge is the sole
poller and `pi-cos.service` reports `telegram connected`.

## Notes / leftovers

- Backups live beside the scripts: `~/pi-service/*.bak-*`.
- The legacy home `~/.pi/cos-orchestrator-agent/cos-orchestrator-agent` is unused; archive it.
- `pi-agent.service` (old home) stays **stopped and disabled** — it shares the bot token.
- CoS `/usage`, the token ledger and `telegram.json` are per-home, so the bridge must always run
  under `~/.pi/agent-cos-orchestrator-agent/`.
