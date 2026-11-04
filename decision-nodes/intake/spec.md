# Node: `intake`

| | |
|---|---|
| **Status** | DRAFT v4 — staged for review. Not registered, not wired. |
| **Posture** | `observe-only` |
| **Scope** | **global** — `~/.pi/decision-nodes/intake/` |
| **Owner** | pmpmt |
| **Created** | 2026-10-08 · v4 2026-10-09 |
| **Shape** | 1 × `choice` (`act`) + 5 × `noul` (topics), in ONE call |
| **Renamed** | was `request-gate` — the name no longer described the job |

---

## 1. Purpose

The single entry point. Everything spoken or typed to the assistant passes here, gets
**profiled**, and is then routed by deterministic code.

Two axes, because one cannot carry it:

- **`act`** — what the speaker is *doing* (exclusive `choice`, 5 options)
- **topics** — what the utterance *touches* (5 independent `noul`s, any combination)

### Why the old taxonomy kept failing

The v1–v3 taxonomy mixed **content kinds** (`journal`, `finance`) with **action kinds**
(`calendar`, `task`) on a single axis. A single axis cannot hold those, which is exactly
why *"I just spent 20 euros on petrol"* was unanswerable — it is **narrate + money +
personal**, three things at once.

| | flat taxonomy | **two axes** |
|---|---|---|
| "spent 20 euros on petrol" | journal *or* finance? undefined | narrate + money + personal ✓ |
| "met Ana at 3pm, spent 40 euros" | impossible | narrate + schedule + personal + contact ✓ |
| add a destination later | renumber, risk class collision | **add one question** ✓ |
| multi-topic turn | lost | natural fan-out ✓ |

Prior art supports it: **Bullet Journal** uses three exclusive bullets (task / event /
note); **finance schemas** (YNAB, Firefly, Beancount) treat income-vs-expenditure as a
*field*, not a class; every serious intent system (Rasa, Home Assistant, Google App
Actions) separates **intent** from **entities** — two axes minimum.

---

## 2. State

| Field | Source | Needed by |
|---|---|---|
| `utterance` | `user_inputs.prompt_text`, after `clean()` | both axes |
| `previous_message_from_assistant` | session jsonl, tail ~1200 chars | **`act` only** |

**Measured:** context changes `act` on **8/30** real rows — and therefore is required.
It changes topic flags on only **2/30**, which look like noise.

> **Architectural consequence: the topic detectors are context-free.** They can be scored
> from `user_inputs` alone. Only `act` needs the session-log join.

State kept deliberately compact — large irrelevant state causes documented "context rot".
Older history, attachments and `surface` are excluded (and confirmed unnecessary).

### Preprocessing

`clean()` strips harness markup: inline `[telegram]`/`[tui]` tokens (keeping the rest of
the line), `[time]`/`[voice]` marker lines, `[attachments]` blocks, trailing `/short`
directives, and extracts voice transcripts out of `[outputs]` blocks.

**Negative result, recorded:** cleaning changed **0 of 28** labels. It is worth doing for
token economy and to keep file paths off a third-party API — **it fixed nothing.**

---

## 3. The questions

```jsonc
{
  "act": {
    "type": "choice",
    "instructions": "What is the speaker doing with these words? Judge the act, not the topic.",
    "criteria": {
      "instruct": "directing an action now: do this, change that, check, send, build, produce, go and find out",
      "ask":      "asking to be told or explained something, with no action being requested",
      "reply":    "responding to the assistant's previous turn: answering its question, picking from options it offered, confirming, correcting, or continuing that same thread",
      "narrate":  "describing what happened, what they did, think, or feel, without asking or directing anything",
      "none":     "nothing meaningful is being said"
    }
  },
  "topic_money":    { "type": "noul", "instructions": "Does this utterance state an amount of money being spent, received, owed, or paid?" },
  "topic_schedule": { "type": "noul", "instructions": "Does this utterance mention a specific event tied to a date, a time, or a place that could belong on a calendar?" },
  "topic_task":     { "type": "noul", "instructions": "Does this utterance create something to be remembered and done later, rather than something to do right now?" },
  "topic_personal": { "type": "noul", "instructions": "Does this utterance contain personal life content worth keeping as a record of the speaker's own life?" },
  "topic_contact":  { "type": "noul", "instructions": "Does this utterance give a person's contact details, or record meeting or speaking with a named person?" }
}
```

Each carries `criteria` true/false boundaries in the implementation (see
`experiment2.py`), because criteria is where boundary cases get pinned down.

**`act` is a `choice`, not five `noul`s — deliberately.** Independent binaries over
mutually-exclusive states are measurably incoherent: one study had Jev score three
exclusive labels separately and the probabilities **summed to 1.14**. One `choice` returns
one normalised distribution.

**Options kept few** (5). Measured elsewhere: accuracy falls **97.7% → 92.3% → 86.7%** as
`choice` options grow 5 → 20 → 59.

---

## 4. Routing (derived, deterministic)

| `act` | topics fired | Destination |
|---|---|---|
| `instruct` | any | the instruction goes to the relevant agent(s) selected by topic |
| `ask` | any | answer directly |
| `reply` | any | continue the current thread |
| `narrate` | `money` | finance ledger |
| `narrate` | `schedule` | calendar (as a record, not an invite) |
| `narrate` | `personal` | journal |
| `narrate` | `task` | task list |
| `narrate` | `contact` | contacts |
| `none` | — | drop |
| **any** | **several** | **fan out to each — this is the point** |

**Thresholds are ours, never the model's.** A `noul` has **no confidence field** — the
probability *is* the signal.

**Fail open on every error path:** classifier error, timeout, malformed answer, or a
missing `stopReason: "stop"` ⇒ nothing is routed and the turn proceeds normally.

**Cost asymmetry drives the thresholds.** A false `journal` in a future enforcing mode
means **an instruction silently never happens**. A false `instruct` means we did the normal
thing. Tune to an explicit **false-negative bound, not accuracy.**

---

## 5. Delivery model — hybrid, per the research

Neither pure classify-at-intake nor pure capture-first. The email-triage literature
converges on:

1. **Always persist the raw utterance first** — immutable, with provenance. Nothing is
   ever lost because a classifier was wrong.
2. **Additionally run intake classification** at the same time.
3. **Route only when confidence clears the bar.**
4. **Anything below it lands in a visible inbox** — *decided: yes.* A short line —
   *"not sure about this one — money + personal?"* — with one correction affordance.

This is the mitigation for the dominant documented failure mode, **silent misfiling**:
rows record *that* a decision happened, never *whether it was right*. The inbox makes
disagreement visible and harvests labelled data almost for free.

**Separate event from assertion.** Keep raw assertions immutable; build the "best fact"
view separately. That is how the spoken-income + PDF-invoice duplicate problem is solved
later — a fingerprint match over a time window, never a destructive merge on text
similarity.

**SLO framing:** *time-to-first-safe-placement* — how long until an utterance is either
filed somewhere reversible or visibly waiting. Not "classification accuracy".

---

## 5b. Deployment — systemd user timer

This host schedules with **systemd user timers** (12 already running), not crontab, so the
sweeper follows that convention. Pi's own cron engine was rejected: it only schedules
`agentTurn` payloads, which would spend a model call to invoke a deterministic script.

| Piece | Path |
|---|---|
| timer | `~/.config/systemd/user/intake-sweep.timer` — `OnCalendar=*:0/5`, `Persistent=true` |
| service | `~/.config/systemd/user/intake-sweep.service` — `Type=oneshot` |
| entry point | `~/.pi/decision-nodes/intake/bin/sweep.sh` — **lives inside the node, so it travels with it** |
| log | `~/.pi/decision-nodes/intake/logs/sweep.log` — counts only, no utterance text |

Two contracts in the wrapper, both deliberate:

1. **Never overlaps** — `flock`; a slow API run must not stack behind the timer.
2. **Always exits 0** — a classifier outage is a fail-open condition, not a unit failure.
   **Verified:** with no `.env` and no database, the wrapper logs the failure and still
   exits **0**, so the timer keeps running and the log resumes by itself.

The wrapper sources `~/.pi/agent/.env` with the same `set -a` pattern as `~/bin/pi`.
Without it every row would abstain for want of a key.

**Logging policy:** silent when there is no work, one line when there is. A timer that
logs an empty run every five minutes trains you to ignore its log.

### Bug found only by running it

`--silent` produced an **empty log even when rows were written**: the summary was gated on
`if not silent or written`, then routed through a `say()` helper that checked `silent`
again — a double guard that swallowed the message the first guard had just allowed.
Reading the diff would never have caught it. This is the argument for executing a node in
its real harness before declaring it done.

---

## 6. Logging — selective capture

| Written | Where |
|---|---|
| timestamp, node id/version, provider+model, `act` + confidence, all five topic probabilities, fired set, latency, usage, `stop_reason`, source row id | `verdicts.jsonl` |
| utterance text | only for abstain-band rows and flagged disagreements, separate file, purged after ~14 days |

Verdicts reference the **source row id** rather than copying text, so no second copy of
personal content exists unless it earns its place. Hashing was rejected: it is not private
for short inputs (`"ok"` is a dictionary lookup away) and it makes the log useless for
tuning.

---

## 7. Classifier configuration

| Path | Provider / model | Credential |
|---|---|---|
| **current** | `typesafe` / `jev-latest` | `TYPESAFE_API_KEY` ✅ verified |
| alternative | `cloudflare-workers-ai` / `@cf/cloudflare/clef-flash` | open weights, Apache-2.0, wire-compatible |
| self-hosted | Laya (421M ModernBERT) | none |

Provider and model resolve from **one config point**; switching costs a key plus one line.

### Verified wire shape

```jsonc
{ "model": "jev-latest", "state": { … }, "questions": { … } }
```

Top-level **`"model"`** is required — omitting it was the cause of my early `400`s.
Raw primitive for yes/no is **`noul`** (`bool` is pi's abstraction name). `probabilities`
is **truncated**, so margin logic must tolerate a missing runner-up.

### Design rules forced by the research

- **Latency is flat in question count** (0.10s → 0.12s across 1→64 judgments), and 10
  questions batched scored 94.0% vs 93.5% separate. **But cost is not flat** — the *state*
  is billed once, then ~8 tokens per question. "One price" is about latency, not tokens.
- **Answers are not jointly coherent.** Never multiply independent `noul` probabilities as
  if they were. Reconcile in code.
- **Dates: detect presence, never reason about them.** Jev is documented as unreliable at
  date comparison. `topic_schedule` answers *"is there a schedule?"*; our code does the rest.
- **Decomposed signal questions beat direct verdicts** — one benchmark moved 62.6% → 95.1%
  by asking narrow signals and combining deterministically. Single unreproduced study, but
  it is the recommended pattern regardless.
- **Negations and double negatives are unreliable** — split into literal questions and
  combine in code.

---

## 8. Measured results — experiment 2 (30 real + 18 probes, 2 conditions)

Real rows = the captured corpus. Probes = a synthetic fixture set, **required because the
real corpus contains no money, journal, task or contact examples at all.**

| Metric | Result |
|---|---|
| Probe topic detection — **recall** | **1.00** (0 false negatives) |
| Probe topic detection — precision | 0.71 no-context / 0.68 with-context |
| Over-fire on real corpus | **0.07 topics/row**, max 1 — the documented Jev yes-lean **did not appear** |
| `act` changed by context | **8/30 real rows**, all → `reply` |
| Topics changed by context | 2/30 real — noise |
| Cost | $0.00423 for 96 calls |

### Wins

- **Zero false negatives** — the failure mode we tuned for does not occur.
- **The old `topic_schedule` false positive is fixed.** id 16 (a passing *"15th of
  September"*) scored **0.86** under v3 criteria and **0.00** now.
- **Fan-out works.** *"I had lunch with Ana at 1pm and spent 40 euros"* fired **four**
  topics correctly where the flat taxonomy could only have picked one.
- **Topic detectors are decisive, not mushy** — `money` on the one real positive scored
  **0.94**, then dropped to 0.06 for every other row.

### Problems, stated plainly

**Most probe "false positives" are my expectations being too narrow, not the model being
wrong.** *"that job earned me 1500 euros"*, *"book a dentist appointment"*, and *"Ana's
number is 912 345 678"* all legitimately fire `personal` — they *are* the speaker's life.
Only two look like genuine errors: `schedule` firing on a **time reference** rather than an
event (*"this morning"*, *"on the 15th"*), and a `task` leak on a negated instruction.

**`topic_personal` may be too broad to be a journal detector.** It fires on anything about
the speaker's life — including money earned and appointments. If everything is personal,
it does not discriminate. **This needs a ruling, not a tweak.**

**The real corpus is silent.** Across 30 real rows: `money` 1, `task` 1, everything else 0.
There are **still no real positives** for journal, contact or schedule. The detectors are
validated only by synthetic probes.

---

## 8b. Real-corpus validation — 326 legacy diary entries (experiment 3)

Source: `voicediary_db.ingestion_ingestitem` (the decommissioned voice diary app) —
**326 entries with text, 2026-04-10 → 2026-10-05**, 204 dictated, 66 email, 59 typed,
English + Portuguese, avg 107 words. Zero API errors. Cost **$0.0147**.

| Measure | Result |
|---|---|
| `act = narrate` | 68% |
| `act = instruct` | 25% |
| `topic_money` / `schedule` / `task` / `personal` / `contact` | 22% / 24% / 13% / 24% / 9% |
| **Multi-topic (>1 detector fires)** | **20%** |
| **Email negative control — `personal` fires** | **0/66** |

### The legacy database is mixed intake, not a journal

The 260 "diary entries" are **not** a set of journal entries. **32% of dictated entries are
instructions** (64/201), 22% involve money, 24% involve a schedule. The old app was already
a catch-all inbox — which is precisely the thing this node exists to sort.

**Consequence: the 30% `personal` rate was never a recall failure. The denominator was
wrong.** Confirmed by reading entries from the "nothing fired" bucket: they are test
recordings (*"The time is 4:25 PM"*, *"This is a test recording"*), work plans, wiring
notes, and project ideas — correctly not personal narration.

### The 46% legacy problem, measured directly

The legacy router used a single exclusive `primary_route` and had to bolt on a
`contains_multiple_items` boolean — flagged on **46%** of items (119/261). Our detectors
independently measure **20%** multi-topic on real data. Both numbers say the same thing:
**one axis cannot carry this**, and fan-out is a real requirement, not a hypothetical.

### Criteria wording is a weak lever — negative result

A/B on `topic_personal` (326 entries × 3 wordings):

| Variant | own entries fire | email fires |
|---|---|---|
| A — v4 as written | 77/260 | 0/66 |
| B — repaired (contradiction removed) | 80/260 | 0/66 |
| C — broadest ("anything personal") | 95/260 | 0/66 |

Removing a genuinely self-contradictory `false` clause (*"a bare statement of fact"* — but a
diary entry **is** a series of statements of fact) gained only **+3**. **Criteria wording is
much weaker than assumed; my hypothesis was largely wrong.** Specificity held at 0/66 for
every variant.

### Two real gaps found

1. **`topic_task` under-fires on plans and intentions.** Entries like *"I'm going to change
the recording time"*, *"I need to implement a summary of…"*, *"the primary task I want to
focus on is…"* fired nothing. The `true` criterion requires "a to-do carrying no specific
time or place"; a stated plan fits neither that nor the exclusions. **Fix: widen `true` to
include stated intentions and plans.**
2. **A missing detector: `idea` / `project`.** *"There's a project that I want to make…"*
fits no current detector — not personal, not a task, not money. Either add `topic_idea` or
explicitly decide that ideas are dropped.

---

## 8c. Final question set — validated (experiment 5)

D7→1b, D8→yes, D9→yes applied. 326 real entries, 0 errors, **$0.0164**.

| detector | own entries (260) | receipt set (66) |
|---|---|---|
| `money` | 6 (2%) | **66 (100%)** — correct, they *are* receipts |
| `schedule` | 79 (30%) | 0 |
| `task` | **151 (58%)** | 0 |
| `personal` | 81 (31%) | 0 |
| `contact` | 28 (11%) | 0 |
| `idea` | 43 (17%) | 0 |

### The "email class" was never a negative control

Those 66 items average **41 characters** and **100% contain money vocabulary**. They are
receipt/purchase lines, not email bodies. So the correct reading is: **five detectors show
perfect specificity (0/66) on them, and the sixth correctly identifies what they are.**

This was verified against the previous run's saved data before being called a regression:
exp3 and exp5 agree on **326/326** verdicts for `money` and `contact`.

### Reproducibility is excellent — no cross-question interference observed

| detector | exp3 | exp5 | identical verdicts |
|---|---|---|---|
| `money` | 72 | 72 | **326/326** |
| `contact` | 28 | 28 | **326/326** |
| `schedule` | 79 | 79 | 324/326 |
| `personal` | 77 | 81 | 290/326 *(wording deliberately changed)* |
| `task` | 43 | 151 | 216/326 *(criteria deliberately changed)* |

Adding a seventh question left `money` and `contact` **bit-identical**. The literature could
not rule out cross-question contamination; at seven questions, **we observe none.** Detectors
that were not deliberately changed did not move.

### D8 worked, possibly too well

Widening `topic_task` to plans and intentions took it from **43 → 151 (+108)**, now firing on
**58% of the speaker's own entries**. Given the corpus is full of work plans this is
defensible, but `task` now co-fires with `schedule` 69 times and with `personal` 44 times. It
may be absorbing material that belongs elsewhere.

Multi-topic rate rose from 20% to **34%** for the same reason.

### `topic_idea` fires but looks noisy

43 entries (17%). Inspection of the shortest firings shows it catching genuine concepts
(*"There's a project that I want to make…"*) but also **notes and lists**: `"Care tracker"`
(12 chars), a plumbing parts list, and one entry that literally says *"put it in the task
list"* — a task, not an idea. Precision needs work before this detector can route anything.

---

## 8d. Negation — measured, and not worth fixing yet (D13 follow-up)

Because "is it worth fixing" deserves data rather than judgement, a dedicated 10-case
negation probe set was written (`fixtures-negation.jsonl`).

| | |
|---|---|
| **false positives** | **0** — negation never *invented* a detection |
| false negatives | 2 — and **both are contestable** |
| clear-cut negation cases | **8/8 correct** |

**The weakness is one-directional:** it suppresses, it never fabricates. The dangerous
direction — creating records that do not exist — is clean.

The two misses:

- **N6** *"don't forget to pay the invoice"* → `money` p=0.08. **My fixture contradicts my
own criteria**: `topic_money` requires an amount to be stated, and none is. The model was
right.
- **N3** *"there is no meeting tomorrow"* → `schedule` p=0.42. Debatable — a statement of
*absence* may not be a calendar item at all.

Meanwhile every unambiguous case passed, including *"cancel the appointment on Friday"*,
*"I didn't go to the meeting yesterday"*, and *"I am not going to the 3pm, it's cancelled"*.

### Rule: fix by ADDITION, never by editing criteria

Editing criteria is a **measured broad lever** — the `personal` repair moved verdicts on 36 of
326 corpus entries; the `task` widening moved **110 of 326**. Editing to satisfy one contested
probe would therefore disturb cases already locked in.

The safe fix is additive: add one literal question (e.g. `mentions_event_despite_negation`)
and combine it with the existing one **in code** — which is what the research recommends for
negations ("split into literal questions and combine in code").

**Additive changes are measurably inert:** adding the seventh question (`topic_idea`) left
`money` and `contact` **bit-identical at 326/326** and `schedule` at 324/326.

**Trigger condition:** only if the live log shows a *pattern* — many `schedule` or `money`
values landing in the 0.3–0.5 band on negated utterances. Every probability is logged, so
this costs nothing to watch for. Right now it is **n=1, contested**.

---

## 9. Failure modes

1. **Calibration is not truth.** Calibration error moved **0.071 from rephrasing a
   question**; 71.6% of multi-class outputs returned exactly 1.00.
2. **Out-of-scope input gets confidently classified**, not refused.
3. **Escalation is not a safety net.** Cascading to a larger model gained **+1.5 points**
   because the fallback shared the blind spots — on high-confidence errors the larger model
   repeated the wrong verdict **96%** of the time. Escalate to a **deterministic** path.
4. **Prompt injection** — utterance and context are both state. Contained only while observing.
5. **Silent misfiling** — the dominant production failure. Mitigated by §5.
6. **Adding a destination can shift an existing threshold's meaning.** Adding a class to a
   closed-set classifier degrades it; adding an independent detector does not. This is the
   structural argument for §3's shape.
7. **Sample bias** — 30 real rows over 3 days, much of it this project's own conversation.

---

## 10. Fixtures

`exp2-review.md` (TEMPORARY, contains text) → 18 probes + 30 real rows.
The probe set is the fixture seed: positives, adversarial negatives, a negation
(*"don't book anything for Tuesday"*), multi-topic fan-out, and two Portuguese rows
(*"Gastei vinte euros no gasóleo hoje"* — code-switching, a known weak spot for this model
class; it passed).

---

## 11. Deliverables and layout

| Varies per node (→ skill input) | Invariant (→ skill machinery) |
|---|---|
| `spec.md` — questions, criteria, thresholds | loading + config resolution |
| `fixtures.jsonl` — labelled examples | the classifier call and error handling |
| state contract | verdict mapping, fail-open |
| routing table | logging, selective capture, purge |
| | eval harness and report format |

```
~/.pi/decision-nodes/intake/
  # ---- the node (phase 1 deliverable) ----
  config.py            # VARIABLE: questions, criteria, thresholds, provider
  core.py              # INVARIANT: clean, context, classify, verdict, route
  sweep.py             # offline sweeper - observe-only, fail-open
  eval.py              # offline scorer - false negatives first, exits 1 on any
  fixtures.jsonl       # 25 probes with must_fire / must_not_fire
  verdicts.jsonl       # runtime log - METADATA ONLY, no utterance text
  spec.md              # this file

  # ---- experiment record (kept for provenance) ----
  experiment.py, experiment2.py, exp3_diary.py, exp4_personal_ab.py, exp5_final.py
  *-results.jsonl     # text-free results from each experiment
```

**Language note:** earlier drafts said `node.ts`. That assumption came from the node being a
pi extension; the design changed to a passive offline sweeper, so Python wins — built-in
SQLite, zero dependencies, and it matches the experiment record. A thin TS hook is only
needed later, at enforcement.

---

## 12. Definition of done — phase 1

1. `spec.md` decided — ✅ all decisions ruled or tracked.
2. `fixtures.jsonl` — ✅ 25 probes, 21 required detections / 44 forbidden. Uses
   **must/must-not**, not exact sets, because exact sets punish correct-but-unlisted
detections — the mistake that produced three false alarms earlier.
3. `sweep.py` + `core.py` + `config.py` — ✅ **36 verdicts written, 0 transport failures,
   9.8s.** Observe-only, fail-open on every path, metadata-only (verified: no text-carrying keys).
4. `eval.py` — ✅ **false negatives reported first and they alone set the exit code.**
   First run: exit 1 on 1 false negative.
5. `verdicts.jsonl` — ✅ filling from real turns, text-free.
6. **Enforcing nothing** — ✅ 36 rows routed: 0.

### What the build itself surfaced

1. **Bug found and fixed:** abstain rows were discarding their topic data, even though topics
   are context-free and independent of `act`. After the fix, **7 of the 9 abstain rows had a
   topic fired anyway** — real signal that was being thrown away.
2. **`ACT_FLOOR = 0.70` abstains on 25% of real turns (9/36)** — confidences 0.25, 0.39,
   0.45, 0.49, 0.59, 0.60, 0.62, 0.62, 0.64. Safe (abstain escalates to the normal path) and
   the topic data survives, but it is a policy knob worth revisiting.
3. **The evaluator caught, on its first run:**
   - **1 false negative** — *"don't book anything for Tuesday"* scored `schedule` **p=0.48**,
     just under the bar. This is the **negation probe**, and the research predicted negation
     handling would be the weak spot. **Note: this may be my fixture expectation being wrong
     again** — a negative instruction arguably is not a calendar event.
   - **1 false positive** — *"I went to the bakery this morning"* fired `schedule`. The D2
     boundary survives in that phrasing.
   - **0 act mismatches.** `money` 5/5, `task` 3/3, `personal` 3/3, `contact` 4/4, `idea` 2/2.

### On the live corpus of 36 turns

`task` 16 · `idea` 9 · `schedule` 3 · `money` 2 · **`personal` 0 · `contact` 0**.
Consistent with a corpus that is project work — and still no journal positives.

**Promotion to enforcing is a separate, later decision** requiring a representative base
rate, real positives for every detector, zero false negatives on fixtures, and a
demonstrated answer to §9 item 4.

---

## 13. Open decisions

| # | Decision | Proposal | Status |
|---|---|---|---|
| **D1** | Is `topic_personal` too broad? It fires on "earned 1500 euros" and "dentist appointment". Narrow it to *diary-style narration only*, or accept it as "any life content"? | narrow it | **open** |
| **D2** | `topic_schedule` fires on time *references* ("this morning"). Tighten to commitments/occurrences only? | yes | **open** |
| **D3** | Collect **real** journal entries — still the biggest gap | user dictates a starter set | **required** |
| **D4** | Visible-inbox wording and interaction | short line + one correction button | proposed |
| **D5** | Purge window for text capture | 14 days | proposed |
| **D6** | Sweeper cadence and deployment | **systemd user timer, every 5 min** | ✅ wired and running |
| **D7** | `topic_personal` wording | **1b — repaired** | ✅ ruled |
| **D8** | Widen `topic_task` to plans and intentions | **yes** | ✅ ruled (43→151, see §8c) |
| **D9** | Add `topic_idea` | **yes** | ✅ ruled (43 fires, precision noisy) |
| **D10** | `topic_task` now fires on 58% of entries and overlaps `schedule` 69×. Accept, or tighten? | investigate before routing | **open** |
| **D11** | `topic_idea` precision — it catches notes and lists | tighten criteria | **open** |
| **D12** | `ACT_FLOOR` 0.70 abstains on 25% of real turns | **0.55 — applied** | ✅ ruled (abstains 25% → 14%) |
| **D13** | Is *"don't book anything for Tuesday"* a `schedule` event? If not, the fixture is wrong, not the model | user ruling | **open** |
