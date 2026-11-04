# Calendar routing: one message in, a route out

> Runbook. The full walkthrough lives with the code: `~/.pi/decision-nodes/calendar/README.md`.
> Written 2026-11-04, when the first unit went live.

## What is wired

| Piece | Path |
|---|---|
| Decision node (router + destinations) | `~/.pi/decision-nodes/calendar/` (`config.py`, `route.py`) |
| Hook that fires it on every message | `~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent/extensions/calendar-router/index.ts` |
| Settings switches | `~/.pi/config.json` → `calendarRouter` |
| Classifier | `~/.pi/jev-classifier/jev-classifier-multi/src/classify.py` (calendar class) |
| Calendar side | `sm-google-workspace` via `gog calendar` (v0.34.0, `calendar` scope granted) |

## Behaviour

1. Every new message is classified by the node's `calendar` class: a match when the
   phrase states the intention to make a calendar entry **or** names a venue **and** a
   date **and** a time.
2. On a match the router returns two destinations, run in order:
   `do:calendar:gog` (read-only — asks the GOG agent what is already booked; its answer
   must open `FREE`, `BUSY` or `UNKNOWN`) and `do:calendar:create` (chained — refuses
   unless the read said `FREE`, extracts the fields, validates them, then runs
   `gog calendar create primary`).
3. **Writes are immediate** when the slot is free — the policy chosen 2026-11-04. No
   confirmation step. `GOG_DRY_RUN = True` in `config.py`, or `mode: "dry"` in the hook,
   stops the write without touching anything else.
4. The trace prints above the reply, and the result is injected so the reply relays it —
   including whether the event was created, so nothing is claimed falsely.
5. On no match, or on any classifier failure: nothing is routed and the turn happens
   normally. An unreadable FREE/BUSY answer counts as UNKNOWN, and UNKNOWN never writes.

## Check it in one command

```bash
cd ~/.pi/decision-nodes/calendar && ./route.py --text "Lunch at Cafe Nero on Friday at 1pm" --dry-run
```

Expect `calendar true`, `decision venue_date_time`, and two destinations marked
`skipped (dry run)`.

## Switches

```json
// ~/.pi/config.json
"calendarRouter": { "enabled": true, "print": true, "mode": "route" }
```

- `mode: "dry"` — classify and print, execute nothing. Use this when testing wording.
- `enabled: false` — hook off entirely. The node still runs by hand.

## Costs

| Step | Cost |
|---|---|
| JEV classification | one request per message, ~300 ms, ~1.1k input + ~140 output tokens at TypeSafe |
| `do:calendar:gog` | one model turn in the sibling, ~10-15 s. Only on a match, and only in `mode: "route"` |
| field extraction | one `deepseek-flash` JSON request, ~1.5k in / 100 out (~$0.0002), outside the pi ledger |
| `do:calendar:create` | one `gog calendar create` call, ~1 s, no tokens |

## Log

`~/.pi/decision-nodes/calendar/verdicts.jsonl`, one line per verdict, no utterance
text. Check the last few with:

```bash
tail -3 ~/.pi/decision-nodes/calendar/verdicts.jsonl | python3 -m json.tool --json-lines
```

## Tests

```bash
# the node: 21 offline tests, no network
python3 ~/.pi/decision-nodes/calendar/tests/test_calendar.py

# the harness side
cd ~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent
npm test -- 2>&1 | grep -E "parseRouteOutput|traceLines|contextBlock|runCalendarRoute"
```

Both suites are offline: canned JSON and tiny Python stubs, no TypeSafe, no Google.

## Next

- A canned calendar read for route 1 (a fixed `gog calendar freebusy` call, no model
  turn) would cut the ~13 s sibling turn. See `docs/INBOX.md`.
- Attendees, reminders and recurrence are supported by `gog` and unused here.
