# Calling keep-agent

`keep-agent` is the orchestrator stripped to its model, tools and usage tracking. It has no
baked-in instructions: the user's message is the task.

| Item | Value |
| --- | --- |
| Home | `~/.pi/agent-keep-agent/keep-agent` (`PI_CODING_AGENT_DIR`) |
| Env | `~/.pi/agent-keep-agent/.env` — provider keys, `DASHBOARD_PORT=8790`, `DASHBOARD_ORIGIN` |
| Launcher | `~/.local/bin/pi-keep-agent` |
| Model | `deepseek` / `deepseek-flash` / thinking `high` (all from `settings.json`) |
| Instructions | `AGENTS.md` — "instructions come from the user" plus generic hygiene. `APPEND_SYSTEM.md` — **zero bytes, frozen** |
| Usage | `logs/ledger.sqlite`, filled from `sessions/` by a user timer; viewed at `http://127.0.0.1:8790` |

## Call

```bash
cd ~/.pi/agent-keep-agent/keep-agent && pi-keep-agent -p "<task in plain language>"
```

There are no slash commands in this home: no `/ask`, `/usage`, `/cron`, `/archive`, `/commit`,
`/sync`, `/reminders`. A `-p` turn is the only way in. Per-run overrides: `--model`, `--thinking`.

## Keep CLI (`keep-cli`)

A bash command in this home that reads Google Keep (personal account, via the internal
`notes/v1` API). Source: `scripts/keep_cli.py`; command on PATH: `~/.local/bin/keep-cli`
(symlink into this home, so editing the script changes the command).

| Command | Does |
| --- | --- |
| `keep-cli --read-all-items` | print every entry: title, body or checkboxes, labels, pinned/archived/trashed, links, attachment types, newest first |
| `keep-cli --read-all-items --json` | the same as JSON (`{"account", "count", "entries"}`) |
| `--include-trashed` · `--no-archived` · `--limit N` | filters (archived shown by default) |
| `keep-cli --get=#2` | one entry by position or node id (quote or `=` the `#`, else bash eats it as a comment) |
| `keep-cli --search milk` | case-insensitive search in titles, bodies and list rows |
| `keep-cli --add "call the plumber" --title T [--color yellow] [--pin]` | create a note; body goes to a child row the way Keep stores it |
| `keep-cli --add-list --title Groceries --item milk --item eggs` | create a list, one `--item` per row |
| `keep-cli --rows [--list Groceries]` | list checkbox rows with `#entry:row` addresses and row ids |
| `keep-cli --item-add "butter" --list Groceries` | append rows to an existing list (`--item-add` repeatable) |
| `keep-cli --check=#1:2` / `--uncheck=Groceries:2` | tick / untick one row: `#entry:row`, `ListTitle:row`, row id, or bare `#entry` for row 1 |
| `keep-cli --trash=#2` / `keep-cli --restore=#2` | move an entry into or out of the bin (reversible; nothing is destroyed) |
| `keep-cli --add ... --dry-run` | print the exact API payload, send nothing |
| `keep-cli --count` (alias `--status`) | entry count only — this was `--check` before rows took that flag |
| `keep-cli --self-test` | offline test of parser and write payloads (29 checks), no network, no credentials |
| `keep-cli --login` · `--web-token <oauth2_4/...>` | store a master token (not needed: a token for `neopmpmtj@gmail.com` is already stored) |

Credentials: `~/.config/keep-cli/credentials.json`, mode 600, holding `email`, `master_token`
(`aas_et/…`, full account access), `android_id` and a cached access token (~1 h). It is kept
outside this home on purpose: rebuilding the agent home does not lose the login.

Full details (endpoints, payloads, token routes, troubleshooting):
`~/.pi/agent/cos-orchestrator-agent/docs/runbooks/google-keep-read-all.md`.

## Usage tracking, from conversation 1 onward

Every turn is recorded, including the ones that happened before the tracker was switched on.

- **Source of truth: `sessions/`.** Pi itself writes one JSONL per session. Never prune it — the
  ledger is only a derived cache of it.
- **Ingest:** `scripts/ingest.ts` reads those files with a per-file byte offset and writes runs,
  calls, tokens and cost into `logs/ledger.sqlite`. A file that grew since the last read is read
  from the offset; a file that shrank is re-read from zero (repeated call ids make that safe).
  So a late or missed ingest backfills everything it skipped — nothing is lost, it is only
  invisible until the next run.
- **Who runs it:** `pi-keep-agent-ledger.timer` (user timer, every 2 min, plus 2 min after boot),
  which starts `pi-keep-agent-ledger.service`. Output is appended to `logs/ingest.log`.
- **How to look:** `pi-keep-agent-dashboard.service` serves the dashboard on
  `http://127.0.0.1:8790` and ingests on every `/api/data` request. Port 8787 stays the
  orchestrator's, 8788 the image describer's, and `DASHBOARD_ORIGIN` in the `.env` allows the
  8790 origin.

```bash
systemctl --user status pi-keep-agent-ledger.timer pi-keep-agent-dashboard.service --no-pager
tail -5 ~/.pi/agent-keep-agent/keep-agent/logs/ingest.log
cd ~/.pi/agent-keep-agent/keep-agent && PI_CODING_AGENT_DIR=$PWD \
  node --experimental-strip-types scripts/ingest.ts     # ingest now, by hand
```

Totals by hand (no dashboard needed):

```bash
cd ~/.pi/agent-keep-agent/keep-agent && node -e '
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
| Every extension (`extensions/`) | Question 3: the calendar and reminder nodes share `~/.pi/config.json`, `~/.pi/decision-nodes/` and `reminders.jsonl` with the orchestrator and could double-write. The rest went with them: cron, archive, chat, `/commit`, the input gates, `secret-scrubber`, `auto-sync`. Recoverable from the `~/.pi` git history or the orchestrator's home |
| Routing source (`src/calendar-node.ts`, `reminder-node.ts`, `jev-classify.ts`, `jev-feedback.ts`, `telegram-delivery.ts`, `input-contains-*.ts`, `less-than-input-words.ts`, `global-config.ts`) | The extensions were already gone; these files still imported the shared classifier and `reminders.jsonl`. Leaving them in a home with no `extensions/` made the tree look like keep still routed, and a later copy of COS's `extensions/` onto this `src/` would double-write. Restore from COS, not from this home |
| `skills/` | Every `SKILL.md` was re-sent each turn — the largest per-turn cost. Instructions come from the user; the agent needs no skills |
| `npm/`, `telegram.json`, `@llblab/pi-telegram` | No bot token, so the bridge could never connect, and it injected six skills into every turn. Revert: `pi install npm:@llblab/pi-telegram` |
| Git automation | The workspace pull is gone from the launcher and `auto-sync` went with the extensions. This home never commits or pushes `~/.pi` |
| `prompts/`, `bin/`, `docs/` (except this file) | Inherited from the orchestrator: prompt templates and vendored `fd`/`rg` binaries nothing referenced, and a 400 KB runbook archive describing *other* agents. Zero prompt cost, but misleading for a specialist |
| Ledger history | Started empty. Conversation 1 of this home (2026-11-06 10:08) is in the ledger |

`APPEND_SYSTEM.md` being empty is the freeze. This home has no `fetch:publications` script
and neither publishes nor consumes a sibling roster.

## What still works

- `ledger/`, `dashboard/`, `scripts/ingest.ts`, `src/default-model.ts` — the usage stack the
  timer and dashboard run, copied in this home so keep stays portable.
- `src/args.ts`, `ask.ts`, `usage.ts`, `effective.ts`, `prompt.ts`, `report.ts`,
  `session-command.ts`, `archive-command.ts` — slash-command parsers with no `extensions/` to
  register them. Kept so a chat extension can be added here without copying those files from COS.
- Tests: `npm test` (76 tests) — ledger, token, dashboard, `/ask` parsers, and model code. No
  calendar, reminder, JEV, or input-gate tests; those modules are not in this home.
- `node_modules` (177 MB) exists only for those three folders; nothing in the prompt path needs it.

## Verify it is still lean

```bash
cd ~/.pi/agent-keep-agent/keep-agent
PI_CODING_AGENT_DIR="$PWD" pi list          # expect: no user packages
ls extensions skills prompts bin 2>&1       # expect: four "No such file or directory"
ls src/calendar-node.ts src/jev-classify.ts src/global-config.ts 2>&1
                                            # expect: three "No such file or directory"
wc -c APPEND_SYSTEM.md                      # expect: 0
pi-keep-agent -p "say ok"                   # expect: no [jev] line, no gate booleans
```

## Host context that still arrives

`/home/pmpmt/AGENTS.md` is loaded by working directory, so any agent started from under `$HOME`
receives the machine facts (Portugal, LAN server `192.168.1.60`, VPS). The frozen
`APPEND_SYSTEM.md` cannot suppress it; only a cwd outside `$HOME` would. `AGENTS.md` tells the
agent to treat those facts as context, not orders.
