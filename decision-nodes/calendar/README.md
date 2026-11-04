# Node: `calendar`

> 2026-11-04. Both destinations are live. The write is **chained** to the read: nothing
> is created unless the calendar check said FREE.

One utterance in. One routing decision out, executed deterministically. No model
decides the route: JEV answers one question, `config.router()` maps that answer to
destination names, and `config.DESTINATIONS` says what each name does.

```
your input
   │
   ├─[1] clean       strip the harness markup pi adds: [telegram], [time], [voice]
   ├─[2] classify    ONE JEV request through jev-classifier-multi  (~300 ms)
   │                 class `calendar`: intention OR (venue AND date AND time)
   ├─[3] route       config.router(row) -> ["do:calendar:gog", "do:calendar:create"]
   ├─[4] execute     in order, each destination seeing the ones before it:
   │                   do:calendar:gog    -> sm-google-workspace, READ-ONLY,
   │                                        answer must open FREE / BUSY / UNKNOWN
   │                   do:calendar:create -> refuses unless FREE, extracts the fields,
   │                                        validates, `gog calendar create`
   └─[5] log         one JSON line in verdicts.jsonl: metadata, never the text
```

## The two destinations

| Destination | Status | What it does |
|---|---|---|
| `do:calendar:gog` | live | Hands the phrase to `sm-google-workspace` as a *read-only* question. Its first token must be **FREE**, **BUSY** or **UNKNOWN**: that token is the gate for the next destination. One model turn there, ~10-15 s. |
| `do:calendar:create` | live | Returns `skipped` unless route 1 said FREE. Then one cheap model call extracts `summary`, `location`, `start`, `end`; the node validates them (parsed, not in the past, confidence ≥ 0.5, sane end); then `gog calendar create primary`. Writes immediately - the confirmation policy chosen 2026-11-04. |

Read before write, and the read can veto: a busy slot, a failed read, or a read that
never ran all stop the write. Every skip reason is printed and logged.

## Run it by hand

```bash
cd ~/.pi/decision-nodes/calendar

# classify + route, run nothing (~0.3 s, no calendar call)
./route.py --text "Lunch with Marta at Cafe Nero on Friday at 1pm" --dry-run

# the real thing: read, then create if FREE
./route.py --text "make me a calendar entry for tomorrow at 3 p.m. to go to the barber"

# machine-readable, for the extension
./route.py --text "..." --json

# from a pipe
printf '%s' "Standup at the office on Monday at 9am" | ./route.py --stdin
```

`GOG_DRY_RUN = True` at the top of `config.py` sends `--dry-run` to the last step:
the whole pipeline runs and gog prints what it *would* create. Use it before
trusting a change.

Exit `0` means a verdict was produced (match or not). Exit `2` means none exists -
missing key, timeout, unreadable answer - and **nothing was routed**.

## What you see

A match that ended in a write (real run, 2026-11-04; the event was deleted afterwards):

```
calendar            true
confidence          0.990
decision            intention
threshold           0.7
rules               states_intention 0.990 · has_venue 0.470 · has_date 0.990 · has_time 0.990 · venue_date_time 0.470
model               jev-1.14.0   latency 285 ms

routes
  do:calendar:gog       ran      sm-google-workspace · 12.8 s · 624 chars
  do:calendar:create    created  Barber appointment · Thu 05 Nov 15:00 → 16:00

phrase
  make me a calendar entry for tomorrow at 3 p.m. to go to the barber

answer from do:calendar:gog
  FREE
  - "Tomorrow" = Thursday 2026-11-05 ...
  - Free/busy for the full local day: empty, so 15:00-16:00 is clear.

event written by do:calendar:create
  summary   Barber appointment
  start     2026-11-05T15:00:00+00:00
  end       2026-11-05T16:00:00+00:00
  id        ijfa0gll9n8k99dqrhhj4vb7ok
```

Three statuses are possible for the write: `created`, `skipped` (with the reason),
`failed` (gog said no). A `skipped` line reads, for example:

```
  do:calendar:create    skipped  route 1 said BUSY - refusing to write
```

A non-match - the ordinary case - routes nothing at all:

```
calendar            false
...
routes
  none - ordinary turn
```

## The fields, and the one model call

JEV returns a verdict and a score, not fields. So `extract_event()` makes **one**
request to `deepseek-flash` (`~/.pi/agent-cos-orchestrator-agent/.env`, key
`DEEPSEEK_API_KEY`) asking for strict JSON: `summary`, `location`, `start_local`,
`end_local`, `confidence`, `reason`. Roughly 1.5k in / 100 out per phrase - about
$0.0002 - and ~1-2 s.

Everything after that call is deterministic: `_validate()` refuses a missing or
unparsable date, a slot in the past, confidence below 0.5, an empty summary; a bad
or missing end time becomes exactly 60 minutes; a blank location becomes none.
`Europe/Lisbon` is attached with `zoneinfo`, so summer and winter offsets are right.

That extraction call is **not** in the pi ledger, because it runs outside a pi turn.
Its token counts are recorded under `event.extract_usage` in `verdicts.jsonl`.

## The harness hook

`extensions/calendar-router/index.ts` in the CoS home runs this node on every
message, before the turn starts, and prints the trace. On a match, the trace and the
result are injected as a hidden block so the turn relays instead of repeating the
work - and it says whether the event was created, so nothing is claimed falsely.

Switched by `~/.pi/config.json`:

```json
"calendarRouter": { "enabled": true, "print": true, "mode": "route" }
```

| Field | Effect |
|---|---|
| `enabled` | `true` only; anything else and the hook does nothing |
| `print` | `false` hides the trace; the routing still happens |
| `mode` | `"route"` executes destinations; `"dry"` classifies and prints `skipped (dry run)` |

The hook never swallows a turn: it always returns `continue`, so the reply is still
written and delivered. Slash commands are skipped (they start with `/`), and a
verdict cannot leak into a later turn - `input` clears it.

## Fails open

Every classifier failure - no key, HTTP error, timeout, malformed JSON - becomes
`abstained: true`, the route list holds `escalate` (`no-op`), and exit is `2`. The
turn then happens as if this node did not exist. A missed calendar entry is silent;
that is the accepted cost of never writing on a false positive.

The write is stricter than the read: an unreadable FREE/BUSY answer counts as
UNKNOWN, and UNKNOWN never writes.

## Log

`verdicts.jsonl`, one line per verdict. Fields: `ts`, `node`, `node_version`,
`utterance_chars`, `abstained`, `reason`, `calendar` (match, confidence, decision,
threshold, rules), `model`, `latency_ms`, and each destination with its status and
note. The utterance text is dropped before the line is written.

## Tests

```bash
python3 ~/.pi/decision-nodes/calendar/tests/test_calendar.py     # 21 offline tests
```

Covers the gate parser, the chain (FREE is the only permission, BUSY and failed reads
short-circuit), the field validator, and the router. No network, no gog.

The harness side has its own suite: `npm test` in the CoS home, `test/calendar-router.test.ts`.

## Files

| File | Purpose |
|---|---|
| `config.py` | **Variable part.** `router()`, both destinations, the gate parser, the extractor, the validator, the gog call |
| `route.py` | **Invariant part.** clean → classify → verdict → route → execute → log, plus the CLI |
| `tests/test_calendar.py` | Offline tests |
| `verdicts.jsonl` | The log (gitignored) |
| `.../extensions/calendar-router/index.ts` | The hook |
| `.../src/calendar-router.ts` | Spawns the node, parses the JSON, builds the trace and the hidden block |
| `.../test/calendar-router.test.ts` | Harness-side tests |

## What is still open

- **No confirmation step.** Decided 2026-11-04: write immediately. If that ever feels
  too eager, the cheapest change is `mode: "dry"` or the `GOG_DRY_RUN` switch, not a
  rewrite.
- **No attendees, reminders, or recurrence.** `gog` supports all three; nothing here
  passes them.
- **A canned calendar read** (like `/inbox-new`) would replace route 1's model turn
  with a fixed `gog calendar freebusy` call. Tracked in `docs/INBOX.md`.
