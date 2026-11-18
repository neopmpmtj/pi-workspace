# Calendar Node Rename and Write Fields — Setup & Implementation Report

**Date:** 2026-11-05
**System:** Laptop `pmpmt-ThinkPad-T15-Gen-2i` (Ubuntu, kernel 7.0.0-38-generic, Pi v1.4.0, Node v24.21.0 via nvm, Python 3.12, `gog` 0.34.0); classifier TypeSafe JEV `jev-latest`; field extractor `deepseek-flash`
**Location:** node `~/.pi/decision-nodes/calendar/` (`config.py`, `route.py`, `tests/test_calendar.py`, `README.md`); harness `~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent/` (`extensions/calendar-node/index.ts`, `src/calendar-node.ts`, `src/global-config.ts`, `test/calendar-node.test.ts`, `settings.json`); switch `~/.pi/config.json` key `calendarNode`; inbox `docs/INBOX.md`

---

## Problem

The live calendar path worked, but two names and one gap made it hard to keep working on.

1. **The harness adapter was called `calendar-router`.** It does not classify and it does not pick a destination. It starts `route.py`, reads one JSON object, and either swallows the turn or lets the agent reply. The name suggested the classification had already happened.
2. **The write dropped attendees, reminders, and recurrence.** `gog calendar create` accepts `--attendees`, `--reminder`, and `--rrule`. `extract_event` never asked for them, and `create_event` never passed them.
3. **The trace of "what the agent is told" was unset.** JEV scores `calendar`, `financial`, and `plan` on every enabled message. It was unclear whether that JSON is given to the agent.

Goal: rename the adapter to the job it does, pass the three extra fields when the phrase names them, and decide whether the agent should receive the JEV result as a hidden note.

---

## Investigation / Root Cause

The path was read from the hook inward. No new classifier was added.

### Who calls whom

| Step | Where | What it does |
| --- | --- | --- |
| 1 | `extensions/calendar-node/index.ts` `input` | Reads `calendarNode` from `~/.pi/config.json`. Off, empty text, or a slash command returns `continue`. |
| 2 | `src/calendar-node.ts` `runCalendarNode` | Spawns `python3 ~/.pi/decision-nodes/calendar/route.py --text … --json`. Fail-open on timeout, exit 2, or junk. |
| 3 | `route.py` `clean` → `classify` → `verdict` | Strips `[telegram]`, `[tui]`, `[time]`, `[voice]`. One subprocess of `classify.py`. Keeps only the `calendar` block. |
| 4 | `route.py` `route` → `execute` | A match runs `do:calendar:gog` then `do:calendar:create`. |
| 5 | The hook | Local match: print trace and outcome, return `handled`. No agent turn, no session entry. |

`classify.py` sends one JEV request covering `calendar`, `financial`, and `plan`. `verdict()` copies `calendar` onto the row and drops the other two. They are not logged and not routed.

### Where the phrase becomes fields

JEV answers whether the phrase is a calendar entry. It does not return a title, a time, or a venue. That parse is `extract_event` in `decision-nodes/calendar/config.py` (line 238), called as the first line of `do_calendar_gog`.

1. `extract_event` posts the phrase to `deepseek-flash` and requires one JSON object.
2. `json.loads`, then `_validate`. A missing time, a past slot, confidence under 0.5, or an empty title stops the read. `gog` is not called.
3. A valid event is stored on `row["event"]`. `gog calendar freebusy` uses that start and end.
4. `do_calendar_create` reuses `row["event"]`. It does not call DeepSeek again. It writes only when the read said `FREE`.

### What the agent actually receives

| Situation | Agent turn | Hidden `calendar-node` block |
| --- | --- | --- |
| Match, local (this laptop) | no — `handled` | no |
| Match, Telegram delivery succeeded | no — `handled` | no |
| Match, Telegram delivery failed | yes | yes: a short brief, not the JSON |
| No match, abstain, or `mode: "dry"` | yes | no |

This laptop does not use Telegram, so a match never reaches the agent. On `continue`, the agent sees the typed phrase and the other hooks' hidden lines. It does not see the JEV JSON.

The hidden block is `before_agent_start` returning `{ message: { customType: "calendar-node", display: false } }`. The screen hides it. The model reads it. That channel already exists. It is used only for a match whose turn was kept.

---

## Architecture / Design Decisions

### 1. Rename the adapter, leave `route.py` named `route.py`

| Name | Verdict |
| --- | --- |
| Keep `calendar-router` | **rejected** — the name is the confusing part. The file starts the node; it does not route. |
| Rename the Python node or `route.py` | **rejected** — `route()` and `execute()` are the six-step caller. That name is accurate. |
| **Rename the harness adapter to `calendar-node`** | **chosen** — folder, source, test, config key `calendarNode`, hidden `customType`, and the docs that point at them. |

`classes/calendar.py` stays one file. A `classes/calendar/` package waits until the questions and `decide` no longer fit. New decision nodes stay in `~/.pi/decision-nodes/<name>/` and read their own slice of the JSON `classify.py` already returns. One message stays one JEV call. Recorded in `docs/INBOX.md` under "Next decision nodes (agreed 2026-11-05)".

### 2. Optional fields are dropped, not fatal

Attendees, reminders, and a repeat are asked for in the same DeepSeek call. `_validate` keeps an email, a `popup:30m` or `email:1d` reminder (at most five), and one `FREQ=` rule. A bad value is removed and the event is still written. Guests are stored on the event. `--send-updates` is left at `gog`'s default, so they are not emailed.

### 3. Do not inject the JEV JSON as FYI

| Option | Verdict |
| --- | --- |
| Attach the full classify JSON on every `continue` | **rejected** — the agent already has the phrase. The JSON is a few scores. `financial` and `plan` have no node, so a hidden "this is financial" is ignored or improvised on. |
| Keep the existing hidden brief | **chosen** — it earns its place only when a match was already carried out and the turn was kept, so the agent does not create the event again. |

### 4. Duplicate guard stays, and is on hold

The title check in the same window still runs. Matching a second phrasing of the same event ("Dinner with Rita" vs "Rita dinner") was not changed. Marked **on hold** in `docs/INBOX.md` on 2026-11-05.

### 5. Idle nodes were archived, not wired

`decision-nodes/intake` and `decision-nodes/scheduler` were drafts. Nothing in the live path called them. Both trees were moved to `~/.pi/z.old/.pi/decision-nodes/` by `archive_to_target_full_tree.py`. `route.py` still comments that `clean()` was copied from `scheduler/core.py`; the copy is local, so the archive does not break the node.

---

## Implementation

### Phase 1 — rename

`git mv` of the extension directory, `src/calendar-router.ts`, and `test/calendar-router.test.ts`. Symbols followed the files: `readCalendarNode`, `runCalendarNode`, `registerCalendarNode`, config section `calendarNode`. `settings.json` loads `extensions/calendar-node/index.ts`. The input-path SVG was regenerated from that settings file and `config.json`.

A pi process that was already running keeps the old extension until the next start.

### Phase 2 — write fields

`_SYSTEM` in `config.py` now asks for `attendees`, `reminders`, and `rrule`. `create_event` appends:

```text
--attendees rita@example.com
--reminder popup:30m
--rrule RRULE:FREQ=WEEKLY
```

The created event object carries those three as display strings. `route.py` prints them. `outcomeLines` in `src/calendar-node.ts` prints them on a swallowed local match.

### Phase 3 — record the non-changes

`docs/INBOX.md`: attendees struck as shipped 2026-11-05; duplicate guard marked on hold; this laptop does not use Telegram. The VPS bridge item stays open. README "Still open" and the calendar runbook say the same.

### Verification

```text
python3 ~/.pi/decision-nodes/calendar/tests/test_calendar.py
# 33 tests, OK

node --experimental-strip-types --test test/calendar-node.test.ts test/calendar-telegram.test.ts
# 22 tests, pass 22
```

Both suites are offline: canned JSON and stubs. No live DeepSeek call and no live `gog create` were run for the new fields.

---

## Files Created/Modified

| File | Lines | Purpose |
| --- | --- | --- |
| `extensions/calendar-node/index.ts` | 135 | Renamed hook. `handled` on a local match. Hidden block only if a match's turn is kept. |
| `src/calendar-node.ts` | 321 | Spawn, parse, trace, outcome. Event type now includes attendees, reminders, rrule. |
| `src/global-config.ts` | 95 | `readCalendarNode()` reads `calendarNode`. |
| `test/calendar-node.test.ts` | 246 | Parse, trace, outcome, spawn fail-open. |
| `~/.pi/config.json` | 24 | `"calendarNode": { "enabled": true, "print": true, "mode": "route" }`. |
| `settings.json` | — | Extension entry is `calendar-node`. |
| `decision-nodes/calendar/config.py` | 528 | Extractor schema, validation, `gog` flags. |
| `decision-nodes/calendar/route.py` | 266 | Prints the three extra event fields. |
| `decision-nodes/calendar/tests/test_calendar.py` | 284 | 33 offline tests, including the new fields. |
| `decision-nodes/calendar/README.md` | 221 | Fields, still-open (duplicate guard on hold), laptop does not use Telegram. |
| `docs/INBOX.md` | 183 | Shipped fields, on-hold guard, next-node plan. |
| `docs/runbooks/calendar-routing.md` | — | Config key `calendarNode`. Laptop Telegram sentence corrected. |
| `docs/runbooks/calendar-routing-on-vps.md` | — | Paths and `calendarNode` key. |
| `apps-scripts/svg-scripts/input-path/input-path.svg` | — | Regenerated. Stations say `calendar-node`. |
| `~/.pi/z.old/.pi/decision-nodes/intake/` | — | Archived 2026-11-05T10-17-19. |
| `~/.pi/z.old/.pi/decision-nodes/scheduler/` | — | Archived 2026-11-05T11-22-50. |

Prompt captures under `state/prompt-capture/` still contain the old name `calendar-router` inside past system prompts. They were left as captures.
