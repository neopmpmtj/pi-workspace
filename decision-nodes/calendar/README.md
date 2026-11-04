# Node: `calendar`

> 2026-11-04. First live unit: **classify a calendar entry, route it, run the routes.**
> One destination is implemented, the second is a stub on purpose.

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
   ├─[4] execute     do:calendar:gog    -> pi-sm-google-workspace, READ-ONLY
   │                 do:calendar:create -> pass   ← the stub, next unit
   └─[5] log         one JSON line in verdicts.jsonl: metadata, never the text
```

## The two destinations

| Destination | Status | What it does |
|---|---|---|
| `do:calendar:gog` | **live** | Hands your phrase to `sm-google-workspace` as a *read-only* question: what is already on the calendar that day and time, is the slot free. It creates nothing. One model turn there, ~20 s. |
| `do:calendar:create` | **stub** | The write. `pass`. Needs venue, date and time as **fields**, and JEV returns a verdict and a score, not fields - so extraction is the missing piece, not the wiring. Kept in the router so the trace and the log keep showing what is still missing. |

Read before write: a false positive costs a calendar read, not a wrong event.

## Run it by hand

```bash
cd ~/.pi/decision-nodes/calendar

# classify + route, run nothing (no calendar call, ~0.3 s)
./route.py --text "Lunch with Marta at Cafe Nero, Rua de Santa Catarina 12, on Friday at 1pm" --dry-run

# the real thing: route 1 runs
./route.py --text "Dentist appointment at Clinica do Douro, Rua A, on Thursday 12 February at 10:30"

# machine-readable, for the extension
./route.py --text "..." --json

# from a pipe
printf '%s' "Standup at the office on Monday at 9am" | ./route.py --stdin --dry-run
```

Exit `0` means a verdict was produced (match or not). Exit `2` means none exists -
missing key, timeout, unreadable answer - and **nothing was routed**.

## What you see

A match, with route 1 executed (real transcript, 2026-11-04):

```
calendar            true
confidence          0.990
decision            venue_date_time
threshold           0.7
rules               states_intention 0.140 · has_venue 0.990 · has_date 0.990 · has_time 0.990 · venue_date_time 0.990
model               jev-1.14.0   latency 369 ms

routes
  do:calendar:gog       ran      sm-google-workspace · 19.2 s · 525 chars
  do:calendar:create    stub     not implemented - next unit

phrase
  Dentist appointment at Clinica do Douro, Rua A, on Thursday 12 February at 10:30

answer from do:calendar:gog
  Read-only check, nothing created or changed. Primary calendar = `neopmpmtj@gmail.com`.
  ...
```

A non-match - the ordinary case - routes nothing:

```
calendar            false
confidence          0.010
decision            none
...
routes
  none - ordinary turn
```

Note `has_date 0.980` in that non-match: JEV saw the date, and the venue and time
rules still said no, so the class stayed false. That is the AND doing its job.

## The harness hook

`extensions/calendar-router/index.ts` in the CoS home runs this node on every
message, before the turn starts, and prints the trace. When it matches, the trace and
the hand-off answer are injected as a hidden block so the turn relays the result
instead of repeating it.

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

Every failure - no key, HTTP error, timeout, malformed JSON - becomes
`abstained: true`, the route list holds `escalate` (`no-op`), and exit is `2`. The
turn then happens as if this node did not exist. A missed calendar entry is silent;
that is the accepted cost of never routing a false positive into a write.

## Log

`verdicts.jsonl`, one line per verdict, appended by `log()`. Fields: `ts`, `node`,
`node_version`, `utterance_chars`, `abstained`, `reason`, `calendar` (match,
confidence, decision, threshold, rules), `model`, `latency_ms`, and the destination
names with their status. The utterance text is dropped before the line is written.

## Files

| File | Purpose |
|---|---|
| `config.py` | **Variable part.** `router()`, the two destination handlers, the classifier path, the sibling launcher path |
| `route.py` | **Invariant part.** clean → classify → verdict → route → execute → log, plus the CLI |
| `verdicts.jsonl` | The log (created on first run) |
| `~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent/extensions/calendar-router/index.ts` | The hook |
| `.../src/calendar-router.ts` | Spawns the node, parses the JSON, builds the trace and the hidden block |
| `.../test/calendar-router.test.ts` | Offline tests: parse, trace, and the fail-open paths |

## Next unit

`do:calendar:create` - fill the `pass`. The order that keeps the routing honest:

1. Extract `venue`, `date`, `time` from the phrase (a second JEV question set, or
   `gog`'s own date parsing) and validate them.
2. `gog calendar create` on `primary`, with a confirmation line.
3. Then - and only then - consider making route 1 an agent turn that creates
   directly, or moving creation into a canned command so it costs no tokens.
