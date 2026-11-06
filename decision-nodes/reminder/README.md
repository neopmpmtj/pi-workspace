# Node: `reminder`

> 2026-11-05. "Remind me to...", "lembra-me de..." become a row in `reminders.jsonl` and a
> 15-minute calendar event. "I bought the milk", "já paguei a luz" close the matching row.
> Separate from `docs/INBOX.md`: reminders are not plans or tasks.

```
your input
   │
   ├─[1] clean       strip the harness markup pi adds
   ├─[2] classify    ONE JEV request (or --classifier-json from the harness)
   │                 arbiter winner: reminder_done > reminder > calendar, band act/hint/none
   ├─[3] route       config.router(row)
   ├─[4] execute     do:reminder:log      -> extractor (title, date, time, kind), validated,
   │                                         appended to reminders.jsonl
   │                 do:reminder:calendar -> `gog calendar create` via the calendar node
   │                 do:reminder:done     -> match against pending rows, close the best one
   └─[5] log         one JSON line in verdicts.jsonl: metadata, never the text
```

## Destinations

| Winner, band | Destinations | Writes |
|---|---|---|
| `reminder`, act | `do:reminder:log`, `do:reminder:calendar` | row + event |
| `reminder_done`, act | `do:reminder:done` | `done` op, future event deleted |
| either, hint | `hint:reminder` / `hint:reminder_done` | nothing; the agent asks |
| anything else | none | ordinary turn |

Defaults: no time is 06:00, or the next full hour when 06:00 today has passed; no date is
**the next occurrence of a stated time** — today while that time is still ahead, tomorrow
once it has passed ("remind me at 9" at 08:21 is today 09:00, at 10:00 it is tomorrow
09:00). With no time stated either, a bare "remind me to buy milk" is tomorrow 06:00.
The event lasts 15 minutes; no freebusy check. A "done" needs a match of at least
0.7, otherwise `no-match` with the pending list. The extractor's `kind` is a second opinion:
`calendar_request` or `other` downgrades the write to a hint.

## The two switches

`~/.pi/config.json` holds `reminderNode`:

| Field | Default | Effect |
|---|---|---|
| `enabled` | — | the hook runs at all |
| `mode` | `"route"` | `"dry"` classifies and routes, runs nothing |
| `print` | true | screen trace |
| `writes` | true | the row in `reminders.jsonl`, its calendar event, the done op |

`writes: false` gates the deterministic path whole, not just the event: the node routes
nothing, so `reminders.jsonl` gains no line, no event is written and nothing is closed. JEV
still classifies and the verdict still lands in `verdicts.jsonl`; the harness then finishes
no turn, and the message reaches the model as an ordinary turn with no hidden block. Same
switch from a shell: `REMINDER_WRITES=0`, or `route.py --no-writes`. The `--list`, `--done`
and `--undo` subcommands are not gated: those are explicit commands, not JEV triggers.

## The table

`reminders.jsonl` is append-only. Each line is one op: `add`, `event` (the calendar id),
`done`, `undo`. `reminder_store.fold` applies every `add` first, then the other ops in file
order, so two hosts merging with `merge=union` (`~/.pi/.gitattributes`) agree on the status.
Ids are `r-YYYYMMDD-xxxx`. On done or undo, a future event is deleted; a past one is kept.

`REMINDER_STORE=/path` overrides the table, for live tests.

## Run it by hand

```bash
./route.py --text "Remind me to buy milk" --dry-run    # classify + route, write nothing
./route.py --text "Lembra-me de pagar a luz na segunda"
./route.py --text "I bought the milk"
./route.py --list [--all]
./route.py --done r-20261105-7be0
./route.py --undo
./route.py --json --text "..."                         # for the extension
```

`GOG_DRY_RUN` at the top of `config.py` sends `--dry-run` to every gog write.

## Tests

```bash
python3 -m unittest discover -s tests
```

Store fold, defaults, validator, second opinion, router, done matching, undo. No network.
Harness side: `test/reminder-node.test.ts` in the CoS home.

## Files

| File | Purpose |
|---|---|
| `config.py` | **Variable part.** router, destinations, extractor, validator, matcher |
| `route.py` | **Invariant part.** clean → classify → verdict → route → execute → log, plus the CLI |
| `reminder_store.py` | The append-only table and its fold |
| `reminders.jsonl` | The table (tracked, `merge=union`) |
| `verdicts.jsonl` | The log (gitignored) |
| `.../extensions/reminder-node/index.ts` | The hook |
| `.../extensions/reminder-commands/index.ts` | `/reminders`, `/reminder-done`, `/reminder-undo` |
| `.../src/reminder-node.ts` | Spawns the node, parses the JSON, builds the trace and the hidden block |
