# Pi State of JEV

> *Last updated: 2026-11-05*
> *Living document — reflects current state, not history.*

---

## Quick Facts

- **Provider**: TypeSafe System One
- **Model**: `jev-latest`
- **Endpoint**: `POST https://api.typesafe.ai/v1/systemone`
- **Key**: `TYPESAFE_API_KEY` in `~/.pi/jev-classifier/.env` (gitignored). The chief-of-staff `.env` does not hold this key.
- **Multi CLI threshold**: `0.7` on every Noul
- **Copied nodes**: gate floor `0.55`, facet threshold `0.50`
- **CLI to run**: `~/.pi/jev-classifier/jev-classifier-multi/`

---

## What's in Use

### Multi classifier

One request scores every class against the same phrase. Each class is an independent match. AND/OR stays in `decide`; the model is not asked to combine conditions.

Run from `~/.pi/jev-classifier`:

```bash
python3 jev-classifier-multi/src/classify.py "lunch at Cafe Nero on Friday at 1pm"
python3 jev-classifier-multi/tests/test_decide.py
```

The test uses fake answers and does not call the API.

- **calendar** — a match when the phrase states the intention to create a calendar entry, or when it has a venue and a date and a time. `confidence` is the higher of the intention score and the lowest of venue, date, and time. `decision` is `intention`, `venue_date_time`, `intention+venue_date_time`, or `none`.
- **financial** — a match when the phrase reports money spent, paid, received, earned, or owed. A price mentioned only inside a plan is not enough. `decision` is `intention` or `none`.
- **plan** — a match when the phrase states a future action or says the speaker is planning. Something already done is not a plan. The word "plan" used for an object (a floor plan, a site plan) is not enough. `decision` is `intention` or `none`.
- **reminder** — the speaker asks to be reminded (remind me to, lembra-me de, não me deixes esquecer). Not: someone else reminding them, "this reminds me of", asking to be told a fact now, code about reminders, adding to an inbox or list.
- **reminder_done** — the speaker reports a reminded task as finished (I bought the milk, done: X, já paguei, podes riscar).
- **vetoes** — `is_past_report`, `is_question` (a polite request phrased as a question is not one), `about_someone_else`, `is_change_or_cancel`. They only block; they never pick a class.

Every question carries the same language note: English, Portuguese, or a mix. Classes auto-load: any module in `classes/` with `QUESTIONS` and `decide` is one class.

`calendar_likeness` now votes: it is the fourth component of the venue-date-time path (`min(venue, date, time, likeness)`, likeness = 1 - P(level 0)), so a bare time and place that does not read like an event no longer acts.

### Arbiter

`jev-classifier-multi/src/arbiter.py`, returned as `winner` by `classify.py --json`.

- Priority `reminder_done` > `reminder` > `calendar`, except that a lower class at `act` beats a higher one at `hint` when it is more than `0.2` more confident.
- Bands: `act` >= 0.85 writes; `hint` >= 0.6 writes nothing and asks the user; below is an ordinary turn.
- Vetoes: >= 0.7 blocks, >= 0.5 caps at `hint`. `reminder_done` listens to `is_question` only; `reminder` to question, change/cancel, someone else; `calendar` to all four.
- After the arbiter, each node's extractor is a second opinion (`kind`, `is_past`); disagreement downgrades the write to a hint.

### Eval

`~/.pi/jev-classifier/eval/`: `jev-golden.jsonl` (149 EN/PT/mixed phrases, ~60% hard negatives), `jev-eval.py` (cached, parallel), `baseline-2026-11-05.json`, `results-2026-11-05.json`. Gate for any change: **false acts = 0**.

| 2026-11-05 | calendar P / R | reminder P / R | reminder_done P / R | false acts | questions | tokens in / out |
|---|---|---|---|---|---|---|
| before (calendar class only) | 0.54 / 1.00 | - / 0 | - / 0 | 24 | 7 | 1037 / 136 |
| after | 1.00 / 0.93 | 1.00 / 1.00 | 1.00 / 0.92 | 0 | 13 | 2091 / 266 |

Latency per call is unchanged at ~0.2-0.5 s (still one request per message; measured 207 ms in the eval, 0.3-0.55 s live).

---

## What's Wired

The first node with a caller: `~/.pi/decision-nodes/calendar/`.

- **Input**: every CoS message, before the turn starts
  (`~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent/extensions/calendar-node/index.ts`),
  switched by `calendarNode` in `~/.pi/config.json`.
- **Judgment**: the multi CLI's `calendar` class, one request, ~300 ms.
- **Routing**: deterministic. `config.router()` returns `do:calendar:gog` (live: one cheap
  extraction call, then `gog calendar freebusy` on that window — no chat turn, ~0.3 s) and
  `do:calendar:create` (live, **chained**: writes only on FREE, skips a duplicate title,
  then `gog calendar create primary`). A match is ~3 s of node work, not a sibling turn.
- **Log**: `~/.pi/decision-nodes/calendar/verdicts.jsonl` - metadata only, no phrase text.
- The second node, `~/.pi/decision-nodes/reminder/`, reads the same classification (the
  harness classifies once per message, `src/jev-classify.ts`) and owns the `reminder` and
  `reminder_done` winners. Runbook: `docs/runbooks/reminder-routing.md` in the CoS home.
- The `scheduler` node is unchanged and still idle. Its `create` gate answers a different
  question - "is this a request to book?" - and abstains on a bare statement such as
  "Lunch at Cafe Nero on Friday at 1pm" (measured 2026-11-04: `other`, 0.10).

## What's Present and Idle

Each of these is on disk and has no caller in the current setup. The phrase classifier to run is the multi CLI above.

- **intake sweep and its destinations** — `~/.pi/decision-nodes/intake/`. The sweeper reads `~/.pi/dbs/user-inputs.sqlite`, which is not on this machine, and `router()` names destinations (`do:<topic>`, `file:<topic>`, `answer`, `continue`, `drop`, `escalate`). Nothing follows them.
- **scheduler sweep and `judge.py`** — `~/.pi/decision-nodes/scheduler/`. The unit files in `scheduler/systemd/` are not installed. `judge.py` still answers `create` or `other` for one utterance if you run it by hand. The calendar question to run is the multi CLI's calendar class, which is what the live `calendar` node calls.
- **`topic_schedule`** — still a facet on intake, and it still fires on a bare date such as "on the 15th of September". The split question (intention, or venue and date and time) is the multi CLI.
- **Cloudflare Clef** — still listed in each copied node's `ENDPOINTS`. Calls go to TypeSafe.
- **`jev-classifier-unit/`** — the earlier calendar-only CLI. It is still on disk. The CLI to run is `jev-classifier-multi/`.

`act` on intake is the only question that reads a previous assistant line. That directory is `~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent/sessions`.

---

## Ledger

There is no ledger node in this repo. The money judgment is the financial class. This classifier does not post amounts or keep the books.

---

## Key Configuration

| Config | Value |
|---|---|
| Model | `jev-latest` |
| Endpoint | `https://api.typesafe.ai/v1/systemone` |
| Key file | `~/.pi/jev-classifier/.env` |
| Multi threshold | `0.7` |
| Node gate floor | `0.55` |
| Node facet threshold | `0.50` |
| Intake questions | `act` plus `topic_money`, `topic_schedule`, `topic_task`, `topic_personal`, `topic_contact`, `topic_idea` |
| Scheduler question | `intent`: `create` or `other` |

---

## Key Files

| File | Purpose |
|---|---|
| `~/.pi/jev-classifier/jev-classifier-multi/src/classify.py` | The CLI to run |
| `~/.pi/jev-classifier/jev-classifier-multi/src/client.py` | Loads `.env` and calls System One |
| `~/.pi/jev-classifier/jev-classifier-multi/src/classes/calendar.py` | Calendar questions and `decide` |
| `~/.pi/jev-classifier/jev-classifier-multi/src/classes/financial.py` | Financial question and `decide` |
| `~/.pi/jev-classifier/jev-classifier-multi/src/classes/plan.py` | Plan question and `decide` |
| `~/.pi/jev-classifier/jev-classifier-multi/tests/test_decide.py` | Offline decision tests |
| `~/.pi/jev-classifier/jev-classifier-unit/src/classify.py` | Earlier calendar-only CLI |
| `~/.pi/jev-classifier/.env` | `TYPESAFE_API_KEY` |
| `~/.pi/decision-nodes/intake/` | Intake node, present and idle |
| `~/.pi/decision-nodes/scheduler/` | Scheduler node, present and idle |
| `~/.pi/decision-nodes/scheduler/bin/judge.py` | One-utterance `create` / `other` gate |
| `~/.pi/jev-classifier/archive-experiments/` | Past measurements |

---

## Past Measurements

They live in `~/.pi/jev-classifier/archive-experiments/`.
