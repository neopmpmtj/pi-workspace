# Pi State of JEV

> *Last updated: 2026-11-04*
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

`calendar_likeness` is requested and printed. It does not vote.

---

## What's Present and Idle

Each of these is on disk and has no caller in the current setup. The phrase classifier to run is the multi CLI above.

- **intake sweep and its destinations** — `~/.pi/decision-nodes/intake/`. The sweeper reads `~/.pi/dbs/user-inputs.sqlite`, which is not on this machine, and `router()` names destinations (`do:<topic>`, `file:<topic>`, `answer`, `continue`, `drop`, `escalate`). Nothing follows them.
- **scheduler sweep and `judge.py`** — `~/.pi/decision-nodes/scheduler/`. The unit files in `scheduler/systemd/` are not installed. `judge.py` still answers `create` or `other` for one utterance if you run it by hand. The calendar question to run is the multi CLI's calendar class.
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
