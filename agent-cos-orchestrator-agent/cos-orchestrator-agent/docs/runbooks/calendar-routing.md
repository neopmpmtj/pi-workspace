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
2. On a match the router returns two destinations:
   `do:calendar:gog` (live, read-only — asks the GOG agent what is already booked) and
   `do:calendar:create` (**stub**, `pass`).
3. The trace prints above the reply, and the hand-off answer is injected so the reply
   relays it. No destination ever writes to the calendar yet.
4. On no match, or on any classifier failure: nothing is routed and the turn happens
   normally.

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
| `do:calendar:gog` | one model turn in the sibling, ~20 s. Only on a match, and only in `mode: "route"` |
| `do:calendar:create` | nothing — it is a stub |

## Log

`~/.pi/decision-nodes/calendar/verdicts.jsonl`, one line per verdict, no utterance
text. Check the last few with:

```bash
tail -3 ~/.pi/decision-nodes/calendar/verdicts.jsonl | python3 -m json.tool --json-lines
```

## Tests

```bash
cd ~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent
npm test -- 2>&1 | grep -E "parseRouteOutput|traceLines|contextBlock|runCalendarRoute"
```

The suite is offline: it parses canned JSON and exercises the fail-open paths with
tiny Python stubs, so it never calls TypeSafe or Google.

## Next unit

Fill `do:calendar:create` in `~/.pi/decision-nodes/calendar/config.py`: extract
`venue`, `date`, `time` as fields, validate, then `gog calendar create` on `primary`.
See `docs/INBOX.md` in this home.
