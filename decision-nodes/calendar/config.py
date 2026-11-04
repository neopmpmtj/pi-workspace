#!/usr/bin/env python3
"""Calendar routing - the VARIABLE part of the `calendar` node.

One utterance in. One routing decision out. Two destinations, both live:

  do:calendar:gog      the phrase is handed to sm-google-workspace, which reads
                       Google Calendar and answers. READ-ONLY. Its first token is
                       FREE, BUSY or UNKNOWN - that token is the gate below.
  do:calendar:create   CHAINED to the read, not independent: it refuses to write
                       unless route 1 said FREE, then extracts venue/date/time,
                       validates them, and runs `gog calendar create` on `primary`.

The classifier is NOT re-implemented here. `jev-classifier-multi` already owns the
calendar question - intention OR venue AND date AND time - and is measured; this
node calls its CLI and reads the answer. That is why a bare statement such as
"Lunch at Cafe Nero on Friday at 1pm" matches, where the `scheduler` node's
`create` gate correctly abstains.

Design notes worth keeping:
  * FAIL OPEN, at the caller: no verdict means no route means an ordinary turn.
  * The router is deterministic. No model is involved in routing.
  * The read is the gate for the write. If it cannot say FREE, nothing is written.
  * One model call for the fields (JEV returns a verdict and a score, not fields).
    Everything after it - validation, the write, the confirmation - is deterministic.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

NODE_NAME = "calendar"
NODE_VERSION = "0.2.0"

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

# Fields, not verdicts: one cheap model call. Key comes from this agent's .env.
EXTRACT_ENV = "~/.pi/agent-cos-orchestrator-agent/.env"
EXTRACT_URL = "https://api.deepseek.com/chat/completions"
EXTRACT_MODEL = "deepseek-flash"
EXTRACT_TIMEOUT_S = 30
EXTRACT_MIN_CONFIDENCE = 0.5

# Destination do:calendar:create. Called directly, so this process needs the
# account and the keyring password that the sibling's launcher normally provides.
GOG_ENV = "~/.pi/agent-gog-workspace-agents/sm-google-workspace/.env"
GOG_CALENDAR = "primary"
TIMEZONE = "Europe/Lisbon"
DEFAULT_MINUTES = 60
GOG_DRY_RUN = False          # True runs `gog --dry-run`: prints, creates nothing


def _now() -> float:
    return time.time()


def _local_now() -> datetime:
    return datetime.now(ZoneInfo(TIMEZONE))


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

    The answer must open with FREE / BUSY / UNKNOWN, because that token is the gate
    the next destination reads. Prose after it is for the user.
    """
    phrase = row.get("utterance", "")
    task = (
        "Read-only Google Calendar question. Do NOT create, move, or delete anything.\n"
        f'My message: "{phrase}"\n'
        "Check my primary calendar for the day and time it names, and whether that slot is free.\n"
        "Your answer MUST start with exactly ONE of these words: FREE, BUSY, or UNKNOWN - "
        "FREE when the slot is free, BUSY when something already overlaps it, UNKNOWN when the "
        "message names no definite date or time or you could not tell. Put that word in the "
        "first non-empty line, then explain in a few lines."
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
            "gate": _gate_of(answer), "answer": answer[-GOG_ANSWER_CHARS:]}


def do_calendar_create(row: dict) -> dict:
    """The write. CHAINED: route 1's verdict is the permission to write.

    Its contract with `route.py`: return a dict, or None for "not implemented".
    A dict with status "skipped"/"failed"/"created" is the normal vocabulary.
    """
    verdict, why = _gate(row)
    if verdict != "FREE":
        return _skip(why)

    event, why = extract_event(row.get("utterance", ""))
    if event is None:
        return _skip(why)

    return create_event(event, row)


def stub_create(row: dict) -> None:
    """The shape before this unit existed. Kept out of DESTINATIONS; no caller."""
    pass


# ------------------------------------------------------------------- the gate

_FREE, _BUSY, _UNKNOWN = "FREE", "BUSY", "UNKNOWN"


def _gate_of(answer: str) -> str:
    """The read's verdict, from the first five non-empty lines. UNKNOWN otherwise."""
    lines = [line.strip() for line in (answer or "").splitlines() if line.strip()][:5]
    for line in lines:
        token = line.strip("*`#></ ").upper().split(" ")[0].split(":")[0].strip(".,;!?")
        if token in (_FREE, _BUSY, _UNKNOWN):
            return token
    return _UNKNOWN


def _gate(row: dict) -> tuple[str, str]:
    """Read route 1's result out of the row. Never assumes it ran or succeeded."""
    for result in row.get("routes") or []:
        if result.get("destination") != "do:calendar:gog":
            continue
        if result.get("status") != "ran":
            return _UNKNOWN, f"route 1 {result.get('status')} - refusing to write blind"
        verdict = result.get("gate") or _gate_of(result.get("answer") or "")
        if verdict == _FREE:
            return _FREE, "route 1 said FREE"
        return verdict, f"route 1 said {verdict} - refusing to write"
    return _UNKNOWN, "route 1 did not run - refusing to write blind"


# ----------------------------------------------------------------- the fields

_SYSTEM = (
    "You turn ONE message into ONE Google Calendar event. Reply with a single JSON "
    "object and nothing else.\n\n"
    "Today is {today}; the local time is {clock}; timezone {tz}.\n\n"
    "Schema:\n"
    '{{"summary": "short event title", "location": "venue or null", '
    '"start_local": "YYYY-MM-DDTHH:MM", "end_local": "YYYY-MM-DDTHH:MM", '
    '"confidence": 0.0, "reason": "one short sentence"}}\n\n'
    "Rules:\n"
    "- start_local and end_local are local wall-clock times, no offset.\n"
    "- Resolve relative dates against today. A weekday alone means the next such day.\n"
    "- If no duration is stated, use exactly {minutes} minutes.\n"
    "- summary is a title only: no dates, no times, no 'remind me'.\n"
    "- location is the venue named in the message, or null.\n"
    "- If the message has no definite date or no definite time, set start_local to "
    "null and say why in reason.\n"
)


def extract_event(text: str) -> tuple[dict | None, str]:
    """One model call -> validated fields, or (None, why). Never raises."""
    key = _env_file(EXTRACT_ENV).get("DEEPSEEK_API_KEY", "")
    if not key:
        return None, f"DEEPSEEK_API_KEY not found in {EXTRACT_ENV}"

    now = _local_now()
    system = _SYSTEM.format(today=now.strftime("%A %Y-%m-%d"), clock=now.strftime("%H:%M"),
                            tz=TIMEZONE, minutes=DEFAULT_MINUTES)
    body = {
        "model": EXTRACT_MODEL,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": text}],
    }
    try:
        answer, usage = _post_json(EXTRACT_URL, body, key, EXTRACT_TIMEOUT_S)
    except Exception as exc:  # noqa: BLE001 - fail open, never crash the turn
        return None, f"extraction failed: {type(exc).__name__}: {str(exc)[:160]}"

    try:
        parsed = json.loads(answer)
    except json.JSONDecodeError:
        return None, "extraction did not return JSON"

    event, why = _validate(parsed, now)
    if event is None:
        return None, why
    event["usage"] = usage
    return event, ""


def _validate(parsed: dict, now: datetime) -> tuple[dict | None, str]:
    if not isinstance(parsed, dict):
        return None, "extraction returned no object"

    start_raw = parsed.get("start_local")
    if not isinstance(start_raw, str) or not start_raw:
        return None, f"no definite date/time ({parsed.get('reason') or 'no reason given'})"
    start = _parse_local(start_raw)
    if start is None:
        return None, f"unparsable start {start_raw!r}"

    end = _parse_local(parsed.get("end_local")) if isinstance(parsed.get("end_local"), str) else None
    if end is None or end <= start:
        end = start + timedelta(minutes=DEFAULT_MINUTES)

    confidence = parsed.get("confidence")
    if not isinstance(confidence, (int, float)) or confidence < EXTRACT_MIN_CONFIDENCE:
        return None, f"low confidence ({confidence!r})"

    summary = str(parsed.get("summary") or "").strip()[:120]
    if not summary:
        return None, "empty summary"

    zone = ZoneInfo(TIMEZONE)
    start_local, end_local = start.replace(tzinfo=zone), end.replace(tzinfo=zone)
    if start_local < now - timedelta(minutes=1):
        return None, f"{start_local:%Y-%m-%d %H:%M} is in the past"

    location = parsed.get("location")
    return {
        "summary": summary,
        "location": location.strip()[:200] if isinstance(location, str) and location.strip() else None,
        "start": start_local,
        "end": end_local,
        "confidence": float(confidence),
    }, ""


def _parse_local(value: str) -> datetime | None:
    text = value.strip().replace(" ", "T").rstrip("Z")
    for pattern in ("%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, pattern)
        except ValueError:
            continue
    return None


# ------------------------------------------------------------------- the write

def create_event(event: dict, row: dict) -> dict:
    """`gog calendar create` on `primary`. The last deterministic step."""
    env = dict(os.environ)
    env.update(_env_file(GOG_ENV))

    command = ["gog", "calendar", "create", GOG_CALENDAR, "-j",
               "--summary", event["summary"],
               "--from", event["start"].isoformat(),
               "--to", event["end"].isoformat(),
               "--timezone", TIMEZONE,
               "--description", (row.get("utterance") or "")[:1000]]
    if event.get("location"):
        command += ["--location", event["location"]]
    if GOG_DRY_RUN:
        command.append("--dry-run")

    started = _now()
    try:
        proc = subprocess.run(command, capture_output=True, text=True, timeout=60, env=env)
    except subprocess.TimeoutExpired:
        return _skip(f"gog create timed out", status="failed")
    except OSError as exc:
        return _skip(f"gog not runnable: {exc}", status="failed")

    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or f"exit {proc.returncode}").strip()[-300:]
        return _skip(f"gog create failed: {detail}", status="failed")

    created_id, link = _parse_created(proc.stdout)
    when = f"{event['start']:%a %d %b %H:%M} → {event['end']:%H:%M}"
    return {
        "destination": "do:calendar:create",
        "status": "created" if not GOG_DRY_RUN else "dry-run",
        "seconds": round(_now() - started, 1),
        "note": f"{event['summary']} · {when}" + (f" · {event['location']}" if event.get("location") else ""),
        "event": {
            "summary": event["summary"],
            "location": event.get("location"),
            "start": event["start"].isoformat(),
            "end": event["end"].isoformat(),
            "timezone": TIMEZONE,
            "id": created_id,
            "link": link,
            "confidence": event.get("confidence"),
            "extract_usage": event.get("usage"),
        },
    }


def _parse_created(stdout: str) -> tuple[str | None, str | None]:
    try:
        payload = json.loads(stdout.strip() or "{}")
    except json.JSONDecodeError:
        return None, None
    if isinstance(payload, dict):
        if isinstance(payload.get("event"), dict):
            payload = payload["event"]
        return payload.get("id"), payload.get("htmlLink") or payload.get("link")
    return None, None


# ------------------------------------------------------------------- helpers

def _skip(reason: str, status: str = "skipped") -> dict:
    return {"destination": "do:calendar:create", "status": status, "note": reason}


def _env_file(path: str) -> dict:
    """KEY=VALUE lines, exported without ever being printed."""
    values: dict[str, str] = {}
    try:
        with open(os.path.expanduser(path), encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                values[key.strip()] = value
    except OSError:
        pass
    return values


def _post_json(url: str, body: dict, key: str, timeout: int) -> tuple[str, dict]:
    request = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST")
    request.add_header("Authorization", f"Bearer {key}")
    request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    message = (payload.get("choices") or [{}])[0].get("message") or {}
    return message.get("content") or "", payload.get("usage") or {}


DESTINATIONS = {
    "do:calendar:gog": do_calendar_gog,
    "do:calendar:create": do_calendar_create,
}
