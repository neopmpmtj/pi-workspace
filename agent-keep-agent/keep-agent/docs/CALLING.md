# Calling keep-agent

`keep-agent` is a functional copy of the orchestrator agent, with its instruction files frozen.

| Item | Value |
| --- | --- |
| Home | `~/.pi/agent-keep-agent/keep-agent` (`PI_CODING_AGENT_DIR`) |
| Env | `~/.pi/agent-keep-agent/.env` — `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `DASHBOARD_PORT=8788` |
| Launcher | `~/.local/bin/pi-keep-agent` |
| Ledger | `~/.pi/agent-keep-agent/keep-agent/logs/ledger.sqlite` (fresh, created on first run) |
| Model | `deepseek` / `deepseek-flash` / thinking `high` (from `settings.json`; `default-model.json` overrides when present) |

## Call

```bash
cd ~/.pi/agent-keep-agent/keep-agent && pi-keep-agent -p "<task in plain language>"
```

`-p "/ask <question>"` is one provider request with no chat turn, same as the orchestrator's `/ask`.

## What is frozen

Both files are deliberately frozen. Do not regenerate or append to either one.

- `AGENTS.md` — one line only: instructions come from the user.
- `APPEND_SYSTEM.md` — zero bytes. `npm run fetch:publications` rewrites the generated sibling
  table inside this file and will fail on it, because a blank file has no
  `<!-- BEGIN GENERATED: siblings -->` / `<!-- END GENERATED: siblings -->` pair. That is
  expected; this home is not meant to publish or consume a roster. Calling it here is a no-op
  error, not a regression.

## What was changed from the orchestrator

| Area | Copy behaviour |
| --- | --- |
| Tools | Identical: `read`, `bash`, `edit`, `write`, `grep`, `find` |
| Commands | `/ask`, `/usage`, `/sync`, `/cron`, `/archive` — same code |
| Dashboard | Same server, default port `8788` (`DASHBOARD_PORT`) so it can run beside the orchestrator's `8787` |
| Ledger + sessions | Fresh: `logs/ledger.sqlite`, no `sessions/`, no `events.log` |
| Calendar node, reminder node, `/reminders*`, `/jev-wrong` | Files present, **not loaded** in `settings.json`. The gates in `~/.pi/config.json` and the state in `~/.pi/decision-nodes/` and `reminders.jsonl` are shared with the orchestrator, so two live hooks could double-write events and swallow each other's turns |
| `auto-sync.ts` | Not loaded: it commits and pushes the same `~/.pi` repo the orchestrator already pushes |
| Input gates | Loaded unchanged: `inputContainsEmail`, `inputContainsPath`, `inputContainsUrl`, `lessThanInputWords`, plus `cron`, `chat`, `archive`, `secret-scrubber` |
| Telegram | `telegram.json` present but `TELEGRAM_BOT_TOKEN` is **not** in the `.env`, so the bridge reports `telegram disconnected`. One polling owner per bot token: never copy the orchestrator's token here |
| `pi-prompt-capture.ts` | Not loaded (the file is `.disabled` upstream) |

## Re-enabling a disabled extension

Add its line back to `extensions` in `settings.json`, e.g. `"+extensions/calendar-node/index.ts"`.
Do it only after the calendar/reminder state is separated from the orchestrator's.

## Host context that still arrives

`/home/pmpmt/AGENTS.md` is loaded by working directory, not by agent home, so any agent started
from under `$HOME` receives the machine facts (Portugal, LAN server, VPS). The frozen
`AGENTS.md` cannot suppress it; only a cwd outside `$HOME` would.
