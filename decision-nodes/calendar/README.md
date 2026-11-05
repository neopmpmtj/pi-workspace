# Node: `calendar`

> 2026-11-04. Both destinations are live and neither calls a sibling agent: the read is a
> fixed `gog calendar freebusy`, the write is a fixed `gog calendar create`. Whole match,
> end to end: **~3 s**.

One utterance in. One routing decision out, executed deterministically. No model decides
the route: JEV answers one question, `config.router()` maps that answer to destination
names, and `config.DESTINATIONS` says what each name does.

```
your input
   │
   ├─[1] clean       strip the harness markup pi adds: [telegram], [time], [voice]
   ├─[2] classify    ONE JEV request through jev-classifier-multi     ~300 ms
   │                 class `calendar`: intention OR (venue AND date AND time)
   ├─[3] route       config.router(row) -> ["do:calendar:gog", "do:calendar:create"]
   ├─[4] execute     in order, each destination seeing the ones before it:
   │                   do:calendar:gog    -> fields (one model call, ~2 s, validated)
   │                                        + `gog calendar freebusy`       ~0.3 s
   │                   do:calendar:create -> duplicate guard, then
   │                                        `gog calendar create`           ~0.6 s
   └─[5] log         one JSON line in verdicts.jsonl: metadata, never the text
```

## The two destinations

| Destination | Status | What it does |
|---|---|---|
| `do:calendar:gog` | live | Resolves the slot, then asks `gog calendar freebusy` about that window. Verdict: **FREE**, **BUSY** or **UNKNOWN**. Read-only, no chat turn, ~2.5 s. |
| `do:calendar:create` | live | Returns `skipped` unless the read said FREE. Skips if an event with the same title is already in the window. Otherwise `gog calendar create primary`. Writes immediately - the policy chosen 2026-11-04. |

The read is the gate for the write: a busy slot, a failed read, or a read that never ran
all stop it, and the reason is printed and logged.

## Run it by hand

```bash
cd ~/.pi/decision-nodes/calendar

# classify + route, run nothing (~0.3 s, no gog, no model)
./route.py --text "Lunch with Marta at Cafe Nero on Friday at 1pm" --dry-run

# the real thing: resolve, read, write if FREE and not already there
./route.py --text "Dinner with Rita at Restaurante O Lage on Saturday 14 November at 20:00"

# machine-readable, for the extension
./route.py --text "..." --json

# from a pipe
printf '%s' "Standup at the office on Monday at 9am" | ./route.py --stdin
```

`GOG_DRY_RUN = True` at the top of `config.py` sends `--dry-run` to the write: the whole
pipeline runs and gog only prints what it would create. Use it before trusting a change.

Exit `0` means a verdict was produced (match or not). Exit `2` means none exists - missing
key, timeout, unreadable answer - and **nothing was routed**.

## What you see

A match that ended in a write (real run, 2026-11-04; the event was deleted afterwards):

```
calendar            true
confidence          0.990
decision            venue_date_time
threshold           0.7
rules               states_intention 0.190 · has_venue 0.990 · has_date 0.990 · has_time 0.990 · venue_date_time 0.990
model               jev-1.14.0   latency 299 ms

routes
  do:calendar:gog       ran      FREE · Sat 14 Nov 20:00 → 21:00 · nothing busy · gog calendar freebusy · 0.3 s
  do:calendar:create    created  Dinner with Rita · Sat 14 Nov 20:00 → 21:00 · Restaurante O Lage · 0.6 s

phrase
  Dinner with Rita at Restaurante O Lage on Saturday 14 November at 20:00

answer from do:calendar:gog
  freebusy primary 2026-11-14T20:00:00+00:00 → 2026-11-14T21:00:00+00:00: FREE (nothing busy)

event written by do:calendar:create
  summary   Dinner with Rita
  location  Restaurante O Lage
  start     2026-11-14T20:00:00+00:00
  end       2026-11-14T21:00:00+00:00
  id        s4lj6g69daglmt2it1ig69ptck
  link      https://www.google.com/calendar/event?eid=...
```

## Every outcome, in one table

| Situation | Write destination says |
|---|---|
| Slot free, nothing identical there | `created` |
| Something already overlaps the slot | `skipped · the read said BUSY - refusing to write` |
| Same title already in that window | `skipped · already on the calendar (<id>)` |
| Read failed / returned nothing usable | `skipped · the read failed (...) - refusing to write blind` |
| No definite date or time in the phrase | `skipped · no definite date/time (reason)` |
| Slot in the past, confidence < 0.5, empty title | `skipped · <reason>` |
| `gog` refuses the create | `failed · gog create failed: <stderr>` |
| Not a calendar entry at all | no destinations at all: `none - ordinary turn` |

## The fields, and the one model call

JEV returns a verdict and a score, not fields. So the read first makes **one** request to
`deepseek-flash` (`~/.pi/agent-cos-orchestrator-agent/.env`, `DEEPSEEK_API_KEY`) for strict
JSON: `summary`, `location`, `start_local`, `end_local`, `confidence`, `reason`. About
1.5k in / 100 out - roughly $0.0002 - and ~2 s.

Everything after that is deterministic: `_validate()` refuses a missing or unparsable
date, a slot in the past, confidence below 0.5, an empty summary; a bad end time becomes
exactly 60 minutes; a blank location becomes none. `Europe/Lisbon` goes on with
`zoneinfo`, so summer and winter offsets are right.

The resolved event is stashed on the row (`row["event"]`) and the write reuses it: one
extraction, one agreement between the window that was checked and the window that is
written.

That call is **not** in the pi ledger, because it runs outside a pi turn. Its token counts
are recorded under `event.extract_usage` in `verdicts.jsonl`.

## The duplicate guard

`create_event()` first lists the events in the same window and skips when a title already
matches, case-insensitively. Two identical events therefore cannot accumulate: a re-sent
message, a retried run, or a second path trying the same write all collapse to one event.
A failed duplicate check does not block the write - the free/busy read already said FREE.

## The harness hook

`extensions/calendar-node/index.ts` in the CoS home runs this node before every turn,
prints the trace, and finishes the work with no model turn on both surfaces:

| Surface | How the answer reaches you | Cost |
|---|---|---|
| local: TUI, `pi -p` | trace + outcome printed to stdout, input `handled` | ~4 s of node work |
| Telegram (`[telegram` prefix) | the same text sent through the bridge's delivery API (`@llblab/pi-telegram/delivery`, scope `active-turn` then `instance`), input `handled` | ~4 s of node work |

**It only swallows when the answer actually went out.** If Telegram delivery fails -
no bridge bound, no target authorized, runtime unavailable - input continues, the node's
result is attached as a hidden block in `before_agent_start`, and the model relays it. A
Telegram turn is never dropped on the floor.

A handled input never reaches `before_agent_start`, so the work happens once. The verdict
is cached per prompt for the path that does reach it.

> **Telegram runs on the VPS, not here** (decided 2026-11-04). This laptop holds no bot
> token and runs no bridge; the fallback relay is what a Telegram-shaped prompt gets here.
> On the VPS the bridge is loaded in the same process, so delivery succeeds and no model
> turn runs. Enablement checklist, including what `neopmpmtj` was still missing on
> 2026-11-04 (`gog`, `TYPESAFE_API_KEY`, a `git pull`):
> `docs/runbooks/calendar-routing-on-vps.md` in the CoS home.

Switched by `~/.pi/config.json`:

```json
"calendarNode": { "enabled": true, "print": true, "mode": "route" }
```

| Field | Effect |
|---|---|
| `enabled` | `true` only; anything else and the hook does nothing |
| `print` | `false` hides the trace; the routing still happens |
| `mode` | `"route"` executes destinations; `"dry"` classifies and prints `skipped (dry run)` |

**The work runs in an awaited hook, never in a slow `input` handler.** An `input` handler
that awaits a multi-second route used to race the start of the run: the verdict could
arrive after the block was due, and the turn then re-did the work blind. That happened once
on 2026-11-04 (event created, block missing, model re-ran the node) and is why the local
path finishes inside `input` with `handled` and the Telegram path finishes inside
`before_agent_start`.

## Fails open

Every classifier failure - no key, HTTP error, timeout, malformed JSON - becomes
`abstained: true`, the route list holds `escalate` (`no-op`), and exit is `2`. The turn
then happens as if this node did not exist. A missed calendar entry is silent; that is the
accepted cost of never writing on a false positive.

The write is stricter than the read: an unreadable verdict counts as UNKNOWN, and UNKNOWN
never writes.

## Log

`verdicts.jsonl`, one line per verdict. Fields: `ts`, `node`, `node_version`,
`utterance_chars`, `abstained`, `reason`, `calendar` (match, confidence, decision,
threshold, rules), `model`, `latency_ms`, and each destination with its status and note.
The utterance text never reaches the file.

## Tests

```bash
python3 ~/.pi/decision-nodes/calendar/tests/test_calendar.py     # 30 offline tests
```

Covers the free/busy parser, the chain (FREE is the only permission), the field
validator, the duplicate guard, and the router. No network, no gog.

Harness side: `npm test` in the CoS home (`test/calendar-node.test.ts`), 15 tests.

## Files

| File | Purpose |
|---|---|
| `config.py` | **Variable part.** `router()`, both destinations, extractor, validator, duplicate guard, gog calls |
| `route.py` | **Invariant part.** clean → classify → verdict → route → execute → log, plus the CLI |
| `tests/test_calendar.py` | Offline tests |
| `verdicts.jsonl` | The log (gitignored) |
| `.../extensions/calendar-node/index.ts` | The hook |
| `.../src/calendar-node.ts` | Spawns the node, parses the JSON, builds the trace and the hidden block |
| `.../test/calendar-node.test.ts` | Harness-side tests |

## Still open

- **No attendees, reminders, or recurrence.** `gog` supports all three; nothing here
  passes them.
- **The duplicate guard matches titles only.** A second phrasing of the same event ("Dinner
  with Rita" vs "Rita dinner") is not caught.
- **Telegram needs a bridge with a token in this process.** Until this home owns one, the
  relay fallback is what runs. See `docs/INBOX.md`.
