# Calling tasks-agent

`tasks-agent` is the orchestrator stripped to its model, tools and usage tracking. It has no
baked-in instructions: the user's message is the task. Google Tasks is reached with `gog tasks`.

| Item | Value |
| --- | --- |
| Home | `~/.pi/agent-tasks-agent/tasks-agent` (`PI_CODING_AGENT_DIR`) |
| Env | `~/.pi/agent-tasks-agent/.env` — provider keys, `GOG_ACCOUNT`, `GOG_KEYRING_PASSWORD`, `DASHBOARD_PORT=8791`, `DASHBOARD_ORIGIN` |
| Launcher | `~/.local/bin/pi-tasks-agent` (install from `scripts/pi-tasks-agent`) |
| Model | `deepseek` / `deepseek-flash` / thinking `high` (all from `settings.json`) |
| Instructions | `AGENTS.md` — "instructions come from the user" plus `gog tasks`. `APPEND_SYSTEM.md` — **zero bytes, frozen** |
| Usage | `logs/ledger.sqlite`, filled from `sessions/` by a user timer; viewed at `http://127.0.0.1:8791` |

## Call

```bash
cd ~/.pi/agent-tasks-agent/tasks-agent && pi-tasks-agent -p "<task in plain language>"
```

There are no slash commands in this home: no `/ask`, `/usage`, `/cron`, `/archive`, `/commit`,
`/sync`, `/reminders`. A `-p` turn is the only way in. Per-run overrides: `--model`, `--thinking`.

Install the launcher (once per machine):

```bash
install -m 755 ~/.pi/agent-tasks-agent/tasks-agent/scripts/pi-tasks-agent ~/.local/bin/pi-tasks-agent
```

## Google Tasks (`gog tasks`)

`gog` is on PATH (`~/.local/bin/gog`). This home does not ship a Python CLI. Copy oauth into
this agent's `.env` (`GOG_ACCOUNT`, `GOG_KEYRING_PASSWORD`) so a non-interactive bash turn can
unlock the file keyring. The refresh token stays in gog's own store, not in this repo.

Prefer `--json --results-only` or `--plain`, and `--no-input`. `--dry-run` on a write prints
the intended action and sends nothing. `gog tasks --help` / `gog schema tasks` are the flag
source of truth.

| Command | Does |
| --- | --- |
| `gog tasks lists` | list task lists (`lists create --title T` makes one) |
| `gog tasks list <tasklistId>` | list tasks in that list |
| `gog tasks get <tasklistId> <taskId>` | one task |
| `gog tasks raw <tasklistId> <taskId>` | lossless JSON of that task |
| `gog tasks add <tasklistId> --title T [--notes N] [--due YYYY-MM-DD]` | create a task |
| `gog tasks update <tasklistId> <taskId> …` | patch a task |
| `gog tasks done <tasklistId> <taskId>` | mark completed |
| `gog tasks undo <tasklistId> <taskId>` | mark needsAction |
| `gog tasks clear <tasklistId>` | clear completed tasks |
| `gog tasks delete <tasklistId> <taskId> --force --no-input` | delete (needs `--force` when `--no-input`) |

Without `GOG_KEYRING_PASSWORD` a non-interactive shell fails with a keyring TTY error. Without
`GOG_ACCOUNT`, `missing --account`. Both are the caller's environment to fix.

Do not call `keep-cli`, do not write `reminders.jsonl`, and do not create COS calendar reminder
events from this home.

## Usage tracking, from conversation 1 onward

Every turn is recorded, including the ones that happened before the tracker was switched on.

- **Source of truth: `sessions/`.** Pi itself writes one JSONL per session. Never prune it — the
  ledger is only a derived cache of it.
- **Ingest:** `scripts/ingest.ts` reads those files with a per-file byte offset and writes runs,
  calls, tokens and cost into `logs/ledger.sqlite`. A file that grew since the last read is read
  from the offset; a file that shrank is re-read from zero (repeated call ids make that safe).
  So a late or missed ingest backfills everything it skipped — nothing is lost, it is only
  invisible until the next run.
- **Who runs it:** `pi-tasks-agent-ledger.timer` (user timer, every 2 min, plus 2 min after boot),
  which starts `pi-tasks-agent-ledger.service`. Output is appended to `logs/ingest.log`.
- **How to look:** `pi-tasks-agent-dashboard.service` serves the dashboard on
  `http://127.0.0.1:8791` and ingests on every `/api/data` request. Port 8787 stays the
  orchestrator's, 8788 the image describer's, 8789 web-master, 8790 keep-agent, and
  `DASHBOARD_ORIGIN` in the `.env` allows the 8791 origin.

```bash
systemctl --user status pi-tasks-agent-ledger.timer pi-tasks-agent-dashboard.service --no-pager
tail -5 ~/.pi/agent-tasks-agent/tasks-agent/logs/ingest.log
cd ~/.pi/agent-tasks-agent/tasks-agent && PI_CODING_AGENT_DIR=$PWD \
  node --experimental-strip-types scripts/ingest.ts     # ingest now, by hand
```

Totals by hand (no dashboard needed):

```bash
cd ~/.pi/agent-tasks-agent/tasks-agent && node -e '
const {DatabaseSync}=require("node:sqlite");
const db=new DatabaseSync("logs/ledger.sqlite");
console.log(db.prepare("select count(*) runs from runs").get(),
            db.prepare("select count(*) calls, sum(total_tokens) tokens, sum(cost_pi) usd from calls").get());'
```

Rebuild the cache from scratch: delete `logs/ledger.sqlite` and run the ingest above. The next
run reads every session file, because the offsets live in that database.

Known limit: `Linger=no` for this user, so the timer only ticks while `pmpmt` has a session.
That is harmless here — turns only happen while someone is logged in — and any gap is backfilled
on the next tick.

## What is gone, deliberately

| Removed | Why |
| --- | --- |
| Every extension (`extensions/`) | Calendar and reminder nodes share `~/.pi/config.json`, `~/.pi/decision-nodes/` and `reminders.jsonl` with the orchestrator and could double-write. The rest went with them: cron, archive, chat, `/commit`, the input gates, `secret-scrubber`, `auto-sync`. Restore from COS, not from this home |
| Routing source (`src/calendar-node.ts`, `reminder-node.ts`, `jev-classify.ts`, …) | Same double-write risk. This home stays lean |
| `skills/` | Every `SKILL.md` was re-sent each turn. Instructions come from the user |
| `npm/`, `telegram.json`, `@llblab/pi-telegram` | No bot token; one polling owner per token |
| Git automation | This home never commits or pushes `~/.pi` |
| `keep-cli` / Keep API | Tasks, not Keep. Use `gog tasks` |
| Ledger history | Started empty |

`APPEND_SYSTEM.md` being empty is the freeze. This home has no `fetch:publications` script
and neither publishes nor consumes a sibling roster.

## What still works

- `ledger/`, `dashboard/`, `scripts/ingest.ts`, `src/default-model.ts` — the usage stack the
  timer and dashboard run, copied in this home so tasks-agent stays portable.
- `src/args.ts`, `ask.ts`, `usage.ts`, `effective.ts`, `prompt.ts`, `report.ts`,
  `session-command.ts`, `archive-command.ts` — slash-command parsers with no `extensions/` to
  register them. Kept so a chat extension can be added here without copying those files from COS.
- Tests: `npm test` — ledger, token, dashboard, `/ask` parsers, and model code. No calendar,
  reminder, JEV, or input-gate tests; those modules are not in this home.

## Verify it is still lean

```bash
cd ~/.pi/agent-tasks-agent/tasks-agent
PI_CODING_AGENT_DIR="$PWD" pi list          # expect: no user packages
ls extensions skills prompts bin 2>&1       # expect: four "No such file or directory"
ls src/calendar-node.ts src/jev-classify.ts src/global-config.ts scripts/keep_cli.py 2>&1
                                            # expect: four "No such file or directory"
wc -c APPEND_SYSTEM.md                      # expect: 0
pi-tasks-agent -p "say ok"                  # expect: no [jev] line, no gate booleans
```

## Host context that still arrives

`/home/pmpmt/AGENTS.md` is loaded by working directory, so any agent started from under `$HOME`
receives the machine facts (Portugal, LAN server `192.168.1.60`, VPS). The frozen
`APPEND_SYSTEM.md` cannot suppress it; only a cwd outside `$HOME` would. `AGENTS.md` tells the
agent to treat those facts as context, not orders.
