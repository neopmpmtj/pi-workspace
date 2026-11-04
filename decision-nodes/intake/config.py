#!/usr/bin/env python3
"""intake - the VARIABLE part of this node.

This is the file a new node replaces. Everything here is specific to `intake`:
what it asks, what it detects, and how confident it must be. The machinery that
does not change lives in `core.py`. Together they are the seam the
`decision-node-creator` skill cuts along.

SHAPE: one gate (`act`) plus six independent facets (the `topic_*` detectors).

Why facets rather than one exclusive list: a real utterance touches several at
once - measured 20% of real diary entries fire more than one, and the legacy
voice-diary app needed a `contains_multiple_items` boolean on 46% of items
because its single `primary_route` could not express that. Fan-out is the point.
"""
NODE_NAME = "intake"

# --- provider -----------------------------------------------------------------
# Switching costs one line plus TYPESAFE_API_KEY in ~/.pi/jev-classifier/.env.
# Only `typesafe` is verified. Clef is reported wire-compatible with Jev -
# verify before trusting it.
DEFAULT_PROVIDER = "typesafe"
DEFAULT_MODEL = "jev-latest"

ENDPOINTS = {
    "typesafe": ("https://api.typesafe.ai/v1/systemone", "TYPESAFE_API_KEY"),
    "cloudflare": ("https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/@cf/cloudflare/clef",
                   "CLOUDFLARE_API_KEY"),
}

# --- the questions ------------------------------------------------------------
# `role` and `threshold`/`floor` are OURS and are stripped before the request is
# sent; only `type`, `instructions` and `criteria` reach the model.
#
# `act` is a gate and a `choice`, deliberately: several binaries over mutually
# exclusive states are measurably incoherent (three exclusive labels scored
# separately summed to 1.14). Keep its option list short - accuracy falls
# 97.7% -> 92.3% -> 86.7% as options grow 5 -> 20 -> 59.
#
# Criteria wording is a weaker lever than it looks: repairing a genuinely
# self-contradictory clause moved 3 of 260 entries. Do not over-invest here.
QUESTIONS = {
    "act": {
        "type": "choice",
        "role": "gate",
        "floor": 0.55,   # at 0.70 the node abstained on 25% of real turns; 0.55 keeps the signal
        "instructions": "What is the speaker doing with these words? Judge the act, not the topic.",
        "criteria": {
            "instruct": "directing an action now: do this, change that, check, send, build, produce, go and find out",
            "ask": "asking to be told or explained something, with no action being requested",
            "reply": "responding to the assistant's previous turn: answering its question, picking from options it offered, confirming, correcting, or continuing that same thread",
            "narrate": "describing what happened, what they did, think, or feel, without asking or directing anything",
            "none": "nothing meaningful is being said",
        },
    },
    "topic_money": {
        "type": "noul", "role": "facet", "threshold": 0.50,
        "instructions": "Does this state an amount of money being spent, received, owed, or paid?",
        "criteria": {
            "true": "a real amount of money and what it was for, such as a price paid, a bill, a salary, or a reimbursement",
            "false": "no amount of money is stated, or money is only discussed in the abstract rather than as a transaction",
        },
    },
    "topic_schedule": {
        "type": "noul", "role": "facet", "threshold": 0.50,
        "instructions": "Does this mention a commitment or occurrence that belongs on a calendar - something with a when or a where that actually happens?",
        "criteria": {
            "true": "a specific event that occurs at a time or a place: an appointment, a meeting, a booking, a visit, or a planned commitment",
            "false": "only a bare date or time is mentioned without describing an event, or the time is incidental to the meaning, such as 'on the 15th of September' or 'this morning' used in passing",
        },
    },
    "topic_task": {
        "type": "noul", "role": "facet", "threshold": 0.50,
        "instructions": "Does this name something the speaker needs or intends to do later?",
        "criteria": {
            "true": "something the speaker needs or intends to carry out later: a to-do, an errand, a job, or a plan they state they are going to do",
            "false": "an instruction to act right now that carries no ongoing obligation, a question, or a description of something that already happened",
        },
    },
    "topic_personal": {
        "type": "noul", "role": "facet", "threshold": 0.50,
        "instructions": "Is this a record of the speaker's own life experience, rather than something addressed to an assistant?",
        "criteria": {
            "true": "the speaker's own life as they experienced it - what they did, what happened to them, what they are thinking or feeling, however plainly it is stated",
            "false": "it is not about the speaker's own experience: an instruction or a request aimed at an assistant, a question put to someone, a record of a transaction, or material about work in progress",
        },
    },
    "topic_contact": {
        "type": "noul", "role": "facet", "threshold": 0.50,
        "instructions": "Does this give a person's contact details, or record meeting or speaking with a named person?",
        "criteria": {
            "true": "a person is named together with a phone number, email, or address, or the speaker reports meeting or speaking with a named person",
            "false": "no person is named, or a person appears only as part of describing something else with nothing to record about them",
        },
    },
    "topic_idea": {
        "type": "noul", "role": "facet", "threshold": 0.50,
        "instructions": "Does this contain an idea, concept or project the speaker is conceiving, as opposed to a definite plan or something that already happened?",
        "criteria": {
            "true": "an idea or project the speaker is thinking up, proposing, or imagining - something to explore rather than a committed plan to execute",
            "false": "not an idea: a definite plan or to-do, a description of what already happened, a question, or an instruction to an assistant",
        },
    },
}


def router(row: dict) -> list:
    """intake's routing table. Deterministic - no model involved.

    Note this is what phase 3 (journal routing) will act on. Nothing calls it in
    anger yet: the sweeper is observe-only and records the derivation without
    following it.
    """
    if row.get("abstained"):
        return ["escalate"]
    act = (row.get("decisions", {}).get("act") or {}).get("value")
    fired = [t[len("topic_"):] for t in (row.get("fired") or [])]
    if act == "instruct":
        return [f"do:{t}" for t in fired] or ["do"]
    if act == "ask":
        return ["answer"]
    if act == "reply":
        return ["continue"]
    if act == "none":
        return ["drop"]
    return [f"file:{t}" for t in fired] or ["unrouted"]
