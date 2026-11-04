#!/usr/bin/env python3
"""Calendar booking gate - the VARIABLE part of the `scheduler` node.

Replace this file when you clone the node. Everything node-specific lives here;
the machinery that does not change lives in `core.py`.

Roles (see core.py for the full contract):
  gate     an exclusive decision. Below `floor` the whole verdict abstains.
  facet    an independent detector. Fires at or above `threshold`. Several may fire.
  measure  recorded, never gates, never routes.

DESIGN RULES worth keeping:
  * Mutually exclusive states go in ONE `choice`, never several binaries.
  * Keep `choice` option lists short - accuracy falls as options grow.
  * Prefer ADDING a question over EDITING criteria: additive changes were measured
    inert, criteria edits moved a third of a corpus.
  * Fail open. A missed detection is silent; a spurious one costs a route.

THIS NODE IS GATE-ONLY, ON PURPOSE. There is no facet. A facet would have to be
"mentions a date or time", which is exactly the detector that misfires on bare
time references (`intake/spec.md:557`, defect D2). See spec.md section 7 for the
consequence: this node's bar is `act_mismatches == 0`, read from `eval.py --json`,
NOT the exit code - eval.py's fatal metric is facet-based and is empty here.
"""
NODE_NAME = "scheduler"

DEFAULT_PROVIDER = "typesafe"
DEFAULT_MODEL = "jev-latest"

ENDPOINTS = {
    "typesafe": ("https://api.typesafe.ai/v1/systemone", "TYPESAFE_API_KEY"),
}

QUESTIONS = {
    "intent": {
        "type": "choice",
        "role": "gate",
        "floor": 0.55,
        "instructions": (
            "Is the speaker asking to CREATE A NEW calendar booking? "
            "Answer `create` only when the utterance is a request to add a future "
            "appointment, meeting, booking or event to a calendar. "
            "Answer `other` for every question about an existing event, every change, "
            "move or cancellation, every negated, hypothetical or past mention, every "
            "bare mention of a date or time that is not a request, and every message "
            "that is not about a calendar at all."
        ),
        "criteria": {
            "create": (
                "A request to add a NEW future appointment to a calendar. Direct "
                "phrasings ('book me a dentist appointment Tuesday at 10', 'put the "
                "quarterly review in my calendar Friday at 2pm') and indirect ones "
                "that still ask for the booking ('get me in with the dentist Thursday "
                "morning', 'can you find me a slot with Marta tomorrow'). The request "
                "must be about creating; the details may be vague, since missing "
                "details are handled downstream, not here."
            ),
            "other": (
                "Everything else. Specifically: a NEGATION ('I have no meeting "
                "tomorrow', 'I did not book anything'); a bare time or date reference "
                "with no request ('on the 15th of September', 'tomorrow morning'); a "
                "QUESTION about an event that already exists ('what time is my meeting "
                "Friday'); a MODIFY, MOVE or CANCEL request ('move my 3pm to 4pm', "
                "'cancel the dentist'); a HYPOTHETICAL or uncertain one ('I might book "
                "something next week'); a PAST booking ('I booked it yesterday'); a "
                "question about calendar tooling itself ('how do I create an event in "
                "gog'); and any message unrelated to calendars. If the utterance is "
                "ambiguous about whether it asks for a new booking, this is `other` "
                "with low confidence, not `create`."
            ),
        },
    },
}


def router(row: dict) -> list:
    """Map a verdict to destinations. Deterministic - no model involved.

    Contract: this is called for every verdict. Return a list of destination names.
    `core.default_route` files by facet if you do not need anything cleverer.

    Nothing consumes these strings yet: the fast path reads the gate value
    (`core.gate_value(row, "intent")`) directly. They are recorded so the verdict log
    stays readable and so a future router has a name to agree with.
    """
    if row.get("abstained"):
        return ["escalate"]
    if core_gate(row) == "create":
        return ["do:calendar"]
    return ["unrouted"]


def core_gate(row: dict) -> str:
    """The gate's chosen option, or None. Local copy so config stays import-free."""
    decision = (row.get("decisions") or {}).get("intent") or {}
    return decision.get("value")
