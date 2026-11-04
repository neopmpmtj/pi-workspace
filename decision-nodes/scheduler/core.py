#!/usr/bin/env python3
"""decision-node core - the INVARIANT machinery.

This file is node-independent: it does not know what any particular node asks.
Everything node-specific lives in that node's `config.py`. Those two files are the
seam the `decision-node-creator` skill cuts along.

GENERIC CONTRACT
  A node's `config.py` declares:
    QUESTIONS   every question, each with a `type` and a `role`
    router()    optional - maps a verdict to destinations

  Question types (what the classifier is asked):
    choice      pick one option, returns value + confidence
    noul        yes/no, returns a probability (no confidence field)
    score       position on an ordered rubric

  Question roles (what the answer is FOR) - this is the part that makes a node
  generic rather than shaped around one example:
    gate        an exclusive decision. Below `floor` the whole verdict abstains.
    facet       an independent detector. Fires when probability >= `threshold`.
                Several may fire at once - that is fan-out, not an edge case.
    measure     recorded, never gates, never routes. For watching a signal.

  One gate, many facets, some measures is the common shape, but nothing requires
  it: a node may have no gate at all.

RULES THIS FILE ENFORCES, each earned by measurement
  * FAIL OPEN. Every error path yields abstain, and abstain means the caller
    proceeds as though the node did not exist. A missed instruction is silent and
    unrecoverable; a spurious detection costs one wasted route.
  * A `noul` has no confidence field. The probability IS the signal.
  * Separate `choice` questions are NOT a joint distribution, and separate `noul`s
    are not independent evidence. Never multiply them. Threshold each on its own
    and reconcile in code.
  * Mutually exclusive states go in ONE `choice`, never several binaries - three
    exclusive labels scored separately were measured summing to 1.14.
  * Keep `choice` option lists short. Accuracy falls 97.7% -> 92.3% -> 86.7% as
    options grow 5 -> 20 -> 59.
  * Prefer ADDITION over editing. Adding a question left untouched detectors
    bit-identical (326/326); editing criteria moved 110 of 326 entries.
  * Extra keys (role, floor, threshold) are stripped before the request goes out -
    they are ours, not the model's, and conflicting text confuses decisions.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config  # noqa: E402

VERSION = "0.2.0"

GATE, FACET, MEASURE = "gate", "facet", "measure"

# Only these keys are ever sent to the model.
WIRE_KEYS = ("type", "instructions", "criteria")


# ---------------------------------------------------------------- preprocessing

_HARNESS_LINE = re.compile(r"(?m)^\s*\[(time|voice)\][^\n]*$", re.I)
_HARNESS_INLINE = re.compile(r"(?mi)^\s*\[(telegram|tui)\]\s*")
_HARNESS_ANY = re.compile(r"\[(time|voice|telegram|tui)\][^\n]*", re.I)


def clean(raw: str) -> str:
    """Strip pi/telegram harness markup and return the speaker's actual words.

    Measured: this changes 0 of 28 labels. It is done for token economy and to
    keep file paths off a third-party API - not because it fixes classification.
    """
    t = raw or ""

    out_body = ""
    m = re.search(r"\[outputs\]\s*\n(.*?)(?=\n\[[a-z_]+\]|\Z)", t, re.S | re.I)
    if m:
        out_body = " ".join(
            re.sub(r"^\s*-\s*", "", ln).strip()
            for ln in m.group(1).splitlines() if ln.strip()
        )

    t = re.sub(r"\[attachments\][^\n]*(?:\n[ \t]*-[^\n]*)*", "", t, flags=re.I)
    t = re.sub(r"\[outputs\][^\n]*(?:\n[ \t]*-[^\n]*)*", "", t, flags=re.I)
    t = _HARNESS_LINE.sub("", t)
    t = _HARNESS_INLINE.sub("", t)
    t = _HARNESS_ANY.sub(" ", t)

    t = " ".join(ln.strip() for ln in t.splitlines() if ln.strip())
    t = re.sub(r"\s*/short\b", " ", t, flags=re.I)   # a harness directive, not prose
    t = re.sub(r"^\s*/\s+", "", t)                   # leading separator artefact
    t = re.sub(r"\s{2,}", " ", t).strip()

    if len(t) < 15 and out_body:
        t = out_body.strip()
    return t


# ---------------------------------------------------------- conversation context

SESSIONS_DIR = os.path.expanduser(
    "~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent/sessions"
)
CONTEXT_CHARS = 1200


def _text_of(msg) -> str:
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            b.get("text", "") if isinstance(b, dict) and b.get("type") == "text"
            else (b if isinstance(b, str) else "")
            for b in content
        )
    return ""


def _epoch(iso):
    if not iso:
        return None
    try:
        from datetime import datetime
        return datetime.fromisoformat(str(iso).strip().replace("Z", "+00:00")).timestamp()
    except Exception:  # noqa: BLE001
        return None


def prior_exchange(session_id, timestamp, sessions_dir: str | None = None) -> str:
    """The assistant turn immediately before this user turn.

    Only needed when a node asks a conversational question (in the worked example, `act` was
    context-dependent: adding context moved 8 of 30 real turns, every one to
    `reply`). Facet detectors were context-free - 2 of 30, and those looked like
    noise - so a node with facets only can skip this entirely.

    Sessions sit one level deep in per-cwd directories, so the glob is recursive.
    Returns "" when there is no prior turn: a first turn genuinely has none.
    """
    if not session_id:
        return ""
    import glob
    root = sessions_dir or SESSIONS_DIR
    hits = glob.glob(os.path.join(root, "**", f"*{session_id}*.jsonl"), recursive=True)
    if not hits:
        return ""

    turns = []
    try:
        with open(hits[0], encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:  # noqa: BLE001
                    continue
                msg = rec.get("message")
                if isinstance(msg, dict) and msg.get("role") in ("user", "assistant"):
                    turns.append((_epoch(rec.get("timestamp")), msg["role"], _text_of(msg)))
    except OSError:
        return ""

    target = _epoch(timestamp)
    best_i, best_d = None, None
    for i, (epoch, role, _) in enumerate(turns):
        if role != "user" or epoch is None or target is None:
            continue
        delta = abs(epoch - target)
        if best_d is None or delta < best_d:
            best_i, best_d = i, delta
    if best_i is None:
        return ""
    for j in range(best_i - 1, -1, -1):
        if turns[j][1] == "assistant" and turns[j][2].strip():
            return turns[j][2].strip()[-CONTEXT_CHARS:]
    return ""


# --------------------------------------------------------------------- calling

class ClassifierError(Exception):
    """A programming error (bad config, missing key). Transport failures are not fatal."""


def wire_questions(questions: dict | None = None) -> dict:
    """Strip our metadata so only the model's own fields go over the wire."""
    questions = questions if questions is not None else config.QUESTIONS
    return {
        name: {k: v for k, v in spec.items() if k in WIRE_KEYS}
        for name, spec in questions.items()
    }


def resolve_model(provider: str | None = None, model: str | None = None):
    """Provider and model resolve from ONE place per node, so switching costs one line."""
    provider = provider or getattr(config, "DEFAULT_PROVIDER", "typesafe")
    model = model or getattr(config, "DEFAULT_MODEL", "jev-latest")
    endpoints = getattr(config, "ENDPOINTS", None) or {
        "typesafe": ("https://api.typesafe.ai/v1/systemone", "TYPESAFE_API_KEY"),
    }
    if provider not in endpoints:
        raise ClassifierError(f"unknown provider {provider!r}; known: {sorted(endpoints)}")
    url, env_var = endpoints[provider]
    key = os.environ.get(env_var, "")
    if not key:
        raise ClassifierError(f"{env_var} is not set; cannot use provider {provider!r}")
    return {"provider": provider, "model": model, "url": url, "env_var": env_var, "key": key}


def classify(utterance: str, context: str = "", resolved=None, timeout: int = 30,
             questions: dict | None = None):
    """Ask every question about one utterance. Never raises on transport failure.

    Returns (payload, error). `payload` is None when the call failed, and the
    caller must treat that as abstain.
    """
    resolved = resolved or resolve_model()
    state = {"utterance": utterance}
    if context:
        state["previous_message_from_assistant"] = context

    body = json.dumps({"model": resolved["model"], "state": state,
                       "questions": wire_questions(questions)}).encode("utf-8")
    req = urllib.request.Request(resolved["url"], data=body, method="POST")
    req.add_header("Authorization", f"Bearer {resolved['key']}")
    req.add_header("Content-Type", "application/json")

    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            payload["_latency_ms"] = round((time.time() - started) * 1000)
            return payload, None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace") if exc.fp else str(exc)
        return None, f"HTTP {exc.code}: {detail[:200]}"
    except Exception as exc:  # noqa: BLE001 - a classifier must never crash the caller
        return None, f"{type(exc).__name__}: {str(exc)[:200]}"


# ------------------------------------------------------------------- verdicts

def to_verdict(utterance: str, context: str = "", row_id=None, resolved=None,
               questions: dict | None = None):
    """One utterance -> one verdict. Always returns a row, never raises."""
    questions = questions if questions is not None else config.QUESTIONS
    payload, error = classify(utterance, context, resolved, questions=questions)

    row = {
        "source_row_id": row_id,
        "node": getattr(config, "NODE_NAME", "unnamed"),
        "node_version": VERSION,
        "abstained": True,
        "reason": None,
        "decisions": {},
        "detections": {},
        "measures": {},
        "fired": [],
    }

    if error or not payload:
        row["reason"] = f"classifier_error: {error}"
        return row

    if payload.get("stopReason") not in (None, "stop"):
        row["reason"] = f"stopReason={payload.get('stopReason')}"
        return row

    answers = payload.get("answers") or {}
    reasons = []

    for name, spec in questions.items():
        role = spec.get("role", FACET)
        qtype = spec.get("type")
        answer = answers.get(name) or {}

        if qtype == "choice":
            value, conf = answer.get("choice"), answer.get("confidence")
            record = {"type": "choice", "value": value, "confidence": conf, "role": role}
            if role == GATE:
                floor = spec.get("floor", 0.0)
                record["floor"] = floor
                if not value or conf is None or conf < floor:
                    reasons.append(f"{name} below floor (value={value!r} conf={conf})")
            row["decisions"][name] = record

        elif qtype == "noul":
            p = answer.get("noul")
            numeric = isinstance(p, (int, float))
            if role == FACET:
                threshold = spec.get("threshold", 0.5)
                fires = numeric and p >= threshold
                row["detections"][name] = {
                    "type": "noul", "probability": p, "threshold": threshold, "fires": bool(fires),
                }
            else:
                row["measures"][name] = {"type": "noul", "probability": p}

        elif qtype == "score":
            value = answer.get("score")
            conf = answer.get("confidence")
            if role == FACET:
                threshold = spec.get("threshold", 0)
                fires = isinstance(value, (int, float)) and value >= threshold
                row["detections"][name] = {
                    "type": "score", "value": value, "confidence": conf,
                    "threshold": threshold, "fires": bool(fires),
                }
            else:
                row["measures"][name] = {"type": "score", "value": value, "confidence": conf}

        else:
            reasons.append(f"{name}: unsupported question type {qtype!r}")

    row["fired"] = sorted(k for k, v in row["detections"].items() if v.get("fires"))
    row["latency_ms"] = payload.get("_latency_ms")
    row["provider"] = resolved["provider"] if resolved else getattr(config, "DEFAULT_PROVIDER", "?")
    row["model"] = resolved["model"] if resolved else getattr(config, "DEFAULT_MODEL", "?")
    row["usage"] = payload.get("usage")

    if reasons:
        row["reason"] = "; ".join(reasons)
        return row

    row["abstained"] = False
    return row


def gate_value(row: dict, name: str):
    """Convenience accessor for a gate's chosen value."""
    return (row.get("decisions", {}).get(name) or {}).get("value")


def default_route(row: dict) -> list[str]:
    """Fallback routing: file by facet, act by gate value. Nodes normally override."""
    if row.get("abstained"):
        return ["escalate"]
    fired = row.get("fired") or []
    if not fired:
        return ["unrouted"]
    return [f"file:{name}" for name in fired]


def route(row: dict) -> list[str]:
    """Derive destinations. Deterministic - no model involved.

    A node may define `router(row)` in its config; otherwise the default applies.
    """
    custom = getattr(config, "router", None)
    if callable(custom):
        return custom(row)
    return default_route(row)
