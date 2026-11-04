# Node: `scheduler`

| | |
|---|---|
| **Status** | DRAFT - staged, not wired |
| **Posture** | `observe-only` |
| **Scope** | global - `~/.pi/decision-nodes/scheduler/` |
| **Created** | 2026-10-10 |
| **Shape** | **gate-only** — one `choice` gate `intent`, no facets, no measures |

## 1. Purpose

Decide one thing about one utterance: **is the speaker asking to create a new calendar
booking?** Yes → the caller may run the deterministic `gog` fast path. No → the caller
proceeds as though this node did not exist.

When this node says `create`, the caller creates an event on `primary`. When it says
`other` or abstains, the caller does nothing. The node owns the judgment; it does not
own the event, the extraction, or the confirmation.

Consumed by the slice-1 fast path described in
`~/.pi/docs/enhancements/calendar-entry-classification-and-swift-processing.md`.

## 2. State

| Field | Source | Needed by |
|---|---|---|
| `utterance` | the captured text, Telegram surface, `[telegram]` prefix stripped by the caller | `intent` |

One field. No conversational context: the gate asks a presence question about the
current utterance, and facet-style context-free judging is the measured-safe case.

## 3. Questions

| Name | Type | Role | Threshold | Options |
|---|---|---|---|---|
| `intent` | `choice` | gate | floor `0.55` | `create`, `other` |

Two options, deliberately. The skill's rule on option-count accuracy (97.7% → 92.3% →
86.7% at 5 → 20 → 59 options) is not binding at two, and every extra option is a
taxonomy decision the owner has not made. Ambiguity is expressed as **low confidence on
`other`**, that is, as abstain — not as a third label.

`other` is written as an explicit enumeration of hard negatives rather than as "not
create", because a negated definition gives the classifier nothing to match against:
negation, bare time reference, question about an existing event, modify/move/cancel,
hypothetical, past booking, tooling question, non-calendar message.

**Why no facet.** The only facet available would be "mentions a date or time" — and that
is precisely the detector that misfires in `intake` (`intake/spec.md:557`, defect D2,
firing on "on the 15th of September"). Adding it here would import the known defect on
purpose. The gate's `other` criteria carry the boundary instead.

## 4. Routing

| Gate value | `router()` returns |
|---|---|
| abstained | `["escalate"]` |
| `create` | `["do:calendar"]` |
| `other` | `["unrouted"]` |

Nothing consumes these strings. The fast path reads
`core.gate_value(row, "intent")` and the gate's confidence directly; the router exists so
the verdict log stays readable and a future caller has a name to agree with.

## 5. Logging

Metadata only in `verdicts.jsonl` (via `sweep.py`, which is the timer path and is not
wired for this node). The fast path logs its own attempts to `calendar-fastpath.jsonl`.
Utterance text appears in neither: it is already in `user_inputs`.

## 6. Fixtures

`fixtures.jsonl` — 23 probes, `must_fire` / `must_not_fire` empty throughout because
there are no facets; the gate is scored by comparing the fixture's `intent` field to the
verdict. Cardinality is deliberately NOT a property of this gate: multi-entry requests
(a weekly timetable) are scored as ordinary `create` positives, because the gate owns the
judgment (is this a create request?) and not the shape (how many events?) — batching is
handled downstream by the consumer.

| Group | IDs | Content |
|---|---|---|
| Positives | P1–P9 | direct verbs, indirect phrasings (P3, P6), relative time (P1, P5), explicit date (P4); multi-entry: five-item timetable (P7), two events on one stated day (P8), terse two-day create (P9) |
| Hard negatives | H1–H14 | bare time reference (H1), negation (H2), existing-event question (H3), modify (H4), non-calendar (H5), hypothetical (H6), cancel (H7), tooling question (H8); multi-entry near-misses: timetable question (H9), multi cancel (H10), multi hypothetical (H11), habitual statement (H12), multi modify (H13), bare multi-day fact (H14) |

Deliberate near-miss pairs, so a lucky keyword match cannot pass the set:
**H1 ↔ P4** (same date, one is a request), **H3 ↔ P3/P4** (same event nouns),
**H6 ↔ P2** (both contain "book"), **H8 ↔ P4** (both contain "create"/"add").
Multi-entry pairs: **H9 ↔ P7** (timetable nouns, question vs request), **H11 ↔ P7**
(multi-day, hypothetical vs request), **H12 ↔ P7** (identical days, habitual statement
vs request), **H14 ↔ P8/P9** (day+time pairs, bare fact vs request), **H10 ↔ P9**
(identical days, cancel vs create), **H13 ↔ P9** (identical days, modify vs create).

## 7. Evidence

Measured 2026-10-10 on this host, `typesafe` / `jev-latest`, one HTTP call per utterance.

**Correctness — three consecutive runs, 14 fixtures each (42 judgments):**

| Run | Gate mismatches | Abstains | False negatives | Result |
|---|---|---|---|---|
| 1 | 0 | 0 | 0 | PASS |
| 2 | 0 | 0 | 0 | PASS |
| 3 | 0 | 0 | 0 | PASS |

`eval.py` elapsed 3.2 s for 14 probes (≈0.23 s/probe), consistent with the 213–287 ms
measured for `intake` (`intake/verdicts.jsonl:1-5`).

**Confidence distribution (floor is 0.55):**

| Fixture | Confidence, runs 1 / 2 / 3 |
|---|---|
| P1 | 0.98 / 0.98 / **1.0** |
| P2–P6 | 1.0 / 1.0 / 1.0 |
| H1–H7 | 1.0 / 1.0 / 1.0 |
| H8 | 0.94 / 0.94 / **0.92** |

Minimum observed confidence 0.92 — a margin of 0.37 above the floor. The only movement
across runs was P1 (0.98 → 1.0, Δ0.02); nothing sat near the threshold, so the node was
not in the flake zone the skill warns about on this set.

**The intake defect does not reproduce here — the headline result.** H1
("on the 15th of September"), the exact input class that misfires in `intake`, was
classified `other` at confidence 1.0 in all three runs; its near-miss twin P4
("...on the 3rd of November at 9") was classified `create` at 1.0. The boundary the
`intent` criteria draw — request versus mention — held on the pair designed to break it.

**Multi-entry probes (P7–P9, H9–H14) — added 2026-10-11, two runs, 23 fixtures each:**

| Run | Gate mismatches | Abstains | False negatives | Result |
|---|---|---|---|---|
| A | 0 | 0 | 0 | PASS |
| B | 0 | 0 | 0 | PASS |

`eval.py` elapsed 5.3 s for 23 probes (≈0.23 s/probe) in both runs.

One confidence pass over the nine new probes (gate / confidence):

| Fixture | Gate | Confidence |
|---|---|---|
| P7 (five-item timetable) | create | 1.0 |
| P8 (two events, one stated day) | create | 1.0 |
| P9 (terse two-day create) | create | 1.0 |
| H9–H14 (six multi-entry near-misses) | other | 1.0 each |

The result that matters for the design: **cardinality does not move the gate.** A five-entry
timetable and a terse two-day create are both read as `create`, and the six near-misses
sharing their day and time tokens are all read as `other`, with no abstains. On this set
the boundary is request-versus-not-request, not one-event-versus-many — which is why
multi-entry support belongs downstream in the consumer rather than in a new question here.
All nine sit at ceiling, so per section 7.2 they validate the question wording, not the
threshold.

**What this does NOT prove — recorded because a spec with only passes is a guess:**

1. **`eval.py`'s exit code is vacuous for this node.** Its fatal metric is
   facet-based `must_fire` misses (`eval.py:220-223`); with no facets, false negatives are
   structurally always 0, so `PASS` is guaranteed regardless of what the gate does. The
   real bar is `act_mismatches == 0` **and** no positive fixture in `abstains`, both read
   from `eval.py --json`. `eval.py` is INVARIANT, so this is not patched here — it is a
   limitation of the template for gate-only nodes, and worth a template-level fix.
2. **No real positives.** All 23 probes are synthetic. Per the skill's rule 9, synthetic
   probes validate question wording, not the threshold. The confidences sitting at ceiling
   say the probes are easy; the 0.37 margin is therefore optimistic.
3. **Zero false positives on 14 hard negatives is not zero false positives in live use.**
   D2-class risk is mitigated by these fixtures and by the dry-run default, not proven
   solved.
4. **No input-shape verification.** Fixtures are bare utterances. The fast path must strip
   the `[telegram]` surface prefix before classifying; that path is untested here.

## 8. Definition of done

1. `spec.md` decided — this file.
2. `fixtures.jsonl` including adversarial near-misses — done (23 probes).
3. `eval.py` clean on `act_mismatches` and `abstains` — done, three runs.
   *Zero false negatives alone is not the bar for this node; see section 7.1.*
4. `verdicts.jsonl` filling from real turns — **not started**; this node is not wired.
5. Enforcing nothing — no timer, no service, no consumer. The `systemd/` units generated
   at scaffold time are **not installed**.

## 9. Open decisions

| # | Decision | Status |
|---|---|---|
| 1 | Floor value. `0.55` is provisional and copied from the sibling node; evidence says it is not the binding constraint (margin 0.37). Revisit against real traffic, not synthetic. | open |
| 2 | A third option for "asks for a booking but omits the time" — cheaper than paying for an extractor that must then fail validation. Currently that case is `other`-with-low-confidence, or `create`, and the validator skips it either way. | open |
| 3 | Whether `eval.py` should treat gate mismatches as fatal for gate-only nodes. Template-level change; `eval.py` is INVARIANT and was not touched. | open |
| 4 | Whether the caller passes the utterance with or without the `[telegram]` prefix. Untested; strip is assumed. | open |
| 5 | Retire this node's `sweep.py`/`systemd/` if the fast path calls it in-process rather than from a timer — an unused timer path is a liability, not a feature. | open |
