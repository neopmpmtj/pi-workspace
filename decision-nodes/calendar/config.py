#!/usr/bin/env python3
"""Calendar routing - the VARIABLE part of the `calendar` node.

One utterance in. One routing decision out. Two destinations, and only the first
is implemented today.

  do:calendar:gog      the phrase is handed to sm-google-workspace, which reads
                       Google Calendar and answers. READ-ONLY: it creates nothing.
  do:calendar:create   STUB, `pass`. This is the write: put the event on
                       `primary`. Fill it next. The router already returns it so
                       the verdict log and the screen keep showing what is missing.

The classifier is NOT re-implemented here. `jev-classifier-multi` already owns the
calendar question - intention OR venue AND date AND time - and is measured; this
node calls its CLI and reads the answer. That is why a bare statement such as
"Lunch at Cafe Nero on Friday at 1pm" matches, where the `scheduler` node's
`create` gate correctly abstains.

Design notes worth keeping:
  * FAIL OPEN, at the caller: no verdict means no route means an ordinary turn.
  * The router is deterministic. No model is involved in routing.
  * Read before write. A false positive costs a calendar read, not a wrong event.
"""
from __future__ import annotations

import os
import subprocess
import time

NODE_NAME = "calendar"
NODE_VERSION = "0.1.0"

# The classifier this node asks. One HTTP call, ~250 ms, key in
# ~/.pi/jev-classifier/.env, which that CLI loads for itself.
CLASSIFIER = "~/.pi/jev-classifier/jev-classifier-multi/src/classify.py"
CLASSIFIER_TIMEOUT_S = 45

# Destination do:calendar:gog. The launcher sources that repo's own .env, so
# GOG_ACCOUNT and the keyring password never travel through this process.
GOG_DIR = "~/.pi/agent-gog-workspace-agents/sm-google-workspace"
GOG_LAUNCHER = "pi-sm-google-workspace"
GOG_TIMEOUT_S = 240
GOG_ANSWER_CHARS = 1500


def _now() -> float:
    return time.time()


def router(row: dict) -> list:
    """Map a verdict to destination names. Deterministic - no model involved.

    Called once per verdict. An empty list is a real answer: "nothing to route,
    let the turn happen as usual".
    """
    if row.get("abstained"):
        return ["escalate"]
    if not (row.get("calendar") or {}).get("is_match"):
        return []
    return ["do:calendar:gog", "do:calendar:create"]


# --------------------------------------------------------------- destinations

def do_calendar_gog(row: dict) -> dict:
    """Hand the phrase to the Google Workspace agent. READ-ONLY.

    Not `gog` directly: the agent holds the account, the keyring and the ledger,
    and a chat turn there is the contract this repo already publishes. No canned
    calendar command exists yet (see docs/INBOX.md), so this is one model turn.
    """
    phrase = row.get("utterance", "")
    task = (
        "Read-only Google Calendar question. Do NOT create, move, or delete anything.\n"
        f'My message: "{phrase}"\n'
        "Tell me what is already on my primary calendar on the day it names, at the time "
        "it names, and whether that slot is free. Reply in a few lines."
    )
    started = _now()
    try:
        proc = subprocess.run(
            [GOG_LAUNCHER, "-p", task],
            cwd=os.path.expanduser(GOG_DIR),
            capture_output=True, text=True, timeout=GOG_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return {"destination": "do:calendar:gog", "status": "failed",
                "seconds": round(_now() - started, 1),
                "error": f"timeout after {GOG_TIMEOUT_S}s"}
    except OSError as exc:
        return {"destination": "do:calendar:gog", "status": "failed",
                "seconds": round(_now() - started, 1), "error": str(exc)}

    answer = (proc.stdout or "").strip()
    if proc.returncode != 0 or not answer:
        return {"destination": "do:calendar:gog", "status": "failed",
                "seconds": round(_now() - started, 1),
                "error": (proc.stderr or answer or f"exit {proc.returncode}").strip()[-500:]}

    return {"destination": "do:calendar:gog", "status": "ran", "agent": "sm-google-workspace",
            "seconds": round(_now() - started, 1), "chars": len(answer),
            "answer": answer[-GOG_ANSWER_CHARS:]}


def do_calendar_create(row: dict) -> dict:
    """STUB. The write, to be filled next.

    What it will need: venue, date and time as separate fields, then
    `gog calendar create` on `primary` and a confirmation. JEV returns a verdict
    and a score, not fields, so extraction is the missing piece - this cannot be
    finished by wiring alone.

    Returning None is deliberate: the caller prints it as `stub` and moves on.
    """
    pass


DESTINATIONS = {
    "do:calendar:gog": do_calendar_gog,
    "do:calendar:create": do_calendar_create,
}
