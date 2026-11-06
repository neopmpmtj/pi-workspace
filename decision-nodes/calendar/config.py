#!/usr/bin/env python3
"""Calendar routing - the VARIABLE part of the `calendar` node.

One utterance in. One routing decision out. Two destinations, both live:

  do:calendar:gog      resolves the slot (one cheap model call for the fields) and
                       checks it with `gog calendar freebusy`. READ-ONLY, no chat
                       turn. The verdict is FREE, BUSY or UNKNOWN.
  do:calendar:create   CHAINED to the read, not independent: it refuses to write
                       unless the read said FREE, then runs `gog calendar create`
                       on `primary` with the fields the read already resolved.

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
import re
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

NODE_NAME = "calendar"
NODE_VERSION = "0.3.0"

# The classifier this node asks. One HTTP call, ~250 ms, key in
# ~/.pi/jev-classifier/.env, which that CLI loads for itself.
CLASSIFIER = "~/.pi/jev-classifier/jev-classifier-multi/src/classify.py"
CLASSIFIER_TIMEOUT_S = 45

# Destination do:calendar:gog. A fixed gog call, not a chat turn: the free/busy
# window is the event's own slot, resolved in the step above it.
FREEBUSY_TIMEOUT_S = 60
FREEBUSY_CALENDAR = "primary"

# Fields, not verdicts: one cheap model call. Key comes from this agent's .env.
EXTRACT_ENV = "~/.pi/agent/.env"
EXTRACT_URL = "https://api.deepseek.com/chat/completions"
EXTRACT_MODEL = "deepseek-flash"
EXTRACT_TIMEOUT_S = 30
EXTRACT_MIN_CONFIDENCE = 0.5
# Prefix of every extractor-disagreement note; the harness treats those as the hint band.
SECOND_OPINION = "second opinion"

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
    winner = row.get("winner") or {}
    if winner.get("class") != NODE_NAME:
        return []
    if winner.get("band") == "hint":
        return ["hint:calendar"]
    if winner.get("band") != "act":
        return []
    return ["do:calendar:gog", "do:calendar:create"]


def hint_calendar(row: dict) -> dict:
    """The unsure band: nothing runs, the model is told to ask before anything is written."""
    winner = row.get("winner") or {}
    confidence = winner.get("confidence")
    stopped = (winner.get("vetoed_by") or []) + (winner.get("capped_by") or [])
    note = f"maybe a calendar entry ({confidence:.2f})" if isinstance(confidence, float) else "maybe a calendar entry"
    if stopped:
        note += f" · capped by {', '.join(stopped)}"
    return {"destination": "hint:calendar", "status": "hint", "note": note + " - ask before writing"}


# --------------------------------------------------------------- destinations

def do_calendar_gog(row: dict) -> dict:
    """Resolve the slot, then ask `gog calendar freebusy`. READ-ONLY, no chat turn.

    Two steps, ~2.5 s together instead of a ~13 s model turn:
      1. `extract_event` - one cheap model call for summary/location/start/end,
         validated. No fields means no window, so the read stops there.
      2. `gog calendar freebusy primary --from <start> --to <end>` - a fixed call
         whose empty `busy` list is the FREE verdict.

    The resolved event is stashed on the row as `row["event"]` so the write reuses
    it instead of paying for a second extraction. That is the chain, in code.
    """
    event, why = extract_event(row.get("utterance", ""))
    if event is None:
        status = "downgraded" if why.startswith(SECOND_OPINION) else "skipped"
        return {"destination": "do:calendar:gog", "status": status,
                "gate": _UNKNOWN, "note": why}

    row["event"] = event
    when = f"{event['start']:%a %d %b %H:%M} → {event['end']:%H:%M}"

    env = dict(os.environ)
    env.update(_env_file(GOG_ENV))
    command = ["gog", "calendar", "freebusy", FREEBUSY_CALENDAR, "-j",
               "--from", event["start"].isoformat(),
               "--to", event["end"].isoformat()]
    started = _now()
    try:
        proc = subprocess.run(command, capture_output=True, text=True,
                              timeout=FREEBUSY_TIMEOUT_S, env=env)
    except subprocess.TimeoutExpired:
        return {"destination": "do:calendar:gog", "status": "failed", "gate": _UNKNOWN,
                "note": f"freebusy timed out after {FREEBUSY_TIMEOUT_S}s"}
    except OSError as exc:
        return {"destination": "do:calendar:gog", "status": "failed", "gate": _UNKNOWN,
                "note": f"gog not runnable: {exc}"}

    seconds = round(_now() - started, 1)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or f"exit {proc.returncode}").strip()[-300:]
        return {"destination": "do:calendar:gog", "status": "failed", "gate": _UNKNOWN,
                "seconds": seconds, "note": f"freebusy failed: {detail}"}

    try:
        payload = json.loads(proc.stdout.strip() or "{}")
    except json.JSONDecodeError:
        return {"destination": "do:calendar:gog", "status": "failed", "gate": _UNKNOWN,
                "seconds": seconds, "note": "freebusy returned no JSON"}

    verdict, detail = freebusy_verdict(payload)
    return {"destination": "do:calendar:gog", "status": "ran", "gate": verdict,
            "source": "gog calendar freebusy", "seconds": seconds,
            "note": f"{verdict} · {when} · {detail}",
            "answer": f"freebusy {FREEBUSY_CALENDAR} {event['start'].isoformat()} "
                      f"→ {event['end'].isoformat()}: {verdict} ({detail})"}


def do_calendar_create(row: dict) -> dict:
    """The write. CHAINED: the read's verdict is the permission to write.

    Uses `row["event"]`, which the read resolved and validated. Re-extracting here
    would be a second paid call and could disagree with the window that was checked.
    """
    verdict, why = _gate(row)
    if verdict != "FREE":
        return _skip(why)

    event = row.get("event")
    if not isinstance(event, dict):
        return _skip("no resolved fields - the read did not complete")

    return create_event(event, row)


# ------------------------------------------------------------------- the gate

_FREE, _BUSY, _UNKNOWN = "FREE", "BUSY", "UNKNOWN"


def freebusy_verdict(payload: dict) -> tuple[str, str]:
    """`gog calendar freebusy` JSON -> (verdict, one-line detail).

    An empty `busy` list is the FREE verdict; anything unreadable is UNKNOWN, which
    never writes. Structure, measured 2026-11-04:
        {"calendars": {"primary": {"busy": [{"start": ..., "end": ...}]}}}
    """
    calendars = payload.get("calendars")
    if not isinstance(calendars, dict):
        return _UNKNOWN, "freebusy returned no calendars"
    calendar = calendars.get(FREEBUSY_CALENDAR)
    if not isinstance(calendar, dict):
        return _UNKNOWN, f"freebusy returned no {FREEBUSY_CALENDAR} calendar"
    busy = calendar.get("busy") or []
    if not isinstance(busy, list):
        return _UNKNOWN, "freebusy returned a malformed busy list"
    if not busy:
        return _FREE, "nothing busy"

    first = busy[0] if isinstance(busy[0], dict) else {}
    detail = f"busy {first.get('start', '?')} → {first.get('end', '?')}"
    if len(busy) > 1:
        detail += f" (+{len(busy) - 1} more)"
    return _BUSY, detail


def _gate(row: dict) -> tuple[str, str]:
    """Read the read's verdict out of the row. Never assumes it ran or succeeded."""
    for result in row.get("routes") or []:
        if result.get("destination") != "do:calendar:gog":
            continue
        if result.get("status") != "ran":
            reason = result.get("note") or result.get("error") or result.get("status")
            return _UNKNOWN, f"read {result.get('status')} ({reason}) - refusing to write blind"
        verdict = result.get("gate") or _UNKNOWN
        if verdict == _FREE:
            return _FREE, "the read said FREE"
        return verdict, f"the read said {verdict} - refusing to write"
    return _UNKNOWN, "the read did not run - refusing to write blind"


# ----------------------------------------------------------------- the fields

_SYSTEM = (
    "You turn ONE message into ONE Google Calendar event. Reply with a single JSON "
    "object and nothing else.\n\n"
    "Today is {today}; the local time is {clock}; timezone {tz}.\n\n"
    "Schema:\n"
    '{{"summary": "short event title", "location": "venue or null", '
    '"start_local": "YYYY-MM-DDTHH:MM", "end_local": "YYYY-MM-DDTHH:MM", '
    '"attendees": ["name@example.com"] or null, '
    '"reminders": ["popup:30m"] or null, '
    '"rrule": "FREQ=WEEKLY" or null, '
    '"kind": "calendar_request", "is_past": false, '
    '"confidence": 0.0, "reason": "one short sentence"}}\n\n'
    "Rules:\n"
    "- The message may be in English, Portuguese, or a mix.\n"
    "- kind is calendar_request when the message asks for, or states, a new event on the "
    "speaker's own calendar; reminder_request when it asks to be reminded of something; "
    "other for anything else (a question, a past event, someone else's schedule, a "
    "change or cancellation).\n"
    "- is_past is true when the event described has already happened.\n"
    "- start_local and end_local are local wall-clock times, no offset.\n"
    "- Resolve relative dates against today. A weekday alone means the next such day.\n"
    "- If no duration is stated, use exactly {minutes} minutes.\n"
    "- summary is a title only: no dates, no times, no 'remind me'.\n"
    "- location is the venue named in the message, or null.\n"
    "- attendees is only email addresses the message names. Otherwise null.\n"
    "- reminders is only when the message asks to be reminded. Each item is "
    "popup or email, then a colon, then a number and m, h, or d. Otherwise null.\n"
    "- rrule is one rule when the message says the event repeats, with no RRULE: "
    "prefix, such as FREQ=WEEKLY or FREQ=MONTHLY;BYMONTHDAY=11. Otherwise null.\n"
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


def second_opinion(parsed: dict, wanted: str) -> str | None:
    """Why the extractor disagrees with the classifier, or None when it agrees."""
    kind = parsed.get("kind")
    if kind != wanted:
        return f"{SECOND_OPINION}: the extractor read it as {kind or 'nothing'}, not {wanted}"
    if parsed.get("is_past") is True:
        return f"{SECOND_OPINION}: the extractor read it as a past event"
    return None


def _validate(parsed: dict, now: datetime) -> tuple[dict | None, str]:
    if not isinstance(parsed, dict):
        return None, "extraction returned no object"
    disagreement = second_opinion(parsed, "calendar_request")
    if disagreement:
        return None, disagreement

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
    event = {
        "summary": summary,
        "location": location.strip()[:200] if isinstance(location, str) and location.strip() else None,
        "start": start_local,
        "end": end_local,
        "confidence": float(confidence),
    }
    attendees = _attendees(parsed.get("attendees"))
    reminders = _reminders(parsed.get("reminders"))
    rrule = _rrule(parsed.get("rrule"))
    if attendees:
        event["attendees"] = attendees
    if reminders:
        event["reminders"] = reminders
    if rrule:
        event["rrule"] = rrule
    return event, ""


_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_REMINDER = re.compile(r"^(popup|email):[1-9]\d*[mhd]$", re.I)
_RRULE = re.compile(
    r"^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z][A-Z0-9]*=[A-Z0-9,+-]+)*$"
)


def _as_list(value: object) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    if isinstance(value, list):
        return [str(part).strip() for part in value if str(part).strip()]
    return []


def _attendees(value: object) -> list[str]:
    found: list[str] = []
    for item in _as_list(value):
        match = _EMAIL.search(item)
        if match and match.group(0) not in found:
            found.append(match.group(0))
    return found[:20]


def _reminders(value: object) -> list[str]:
    found: list[str] = []
    for item in _as_list(value):
        if _REMINDER.match(item):
            normalized = item.lower()
            if normalized not in found:
                found.append(normalized)
    return found[:5]


def _rrule(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.upper().startswith("RRULE:"):
        text = text[6:]
    text = text.upper()
    if not _RRULE.match(text):
        return None
    return "RRULE:" + text


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
    """`gog calendar create` on `primary`. The last deterministic step.

    Idempotent on purpose: if an event with the same title is already in that window,
    nothing is written. That is what stops a re-sent message - or a second path that
    tried the same write - from producing two identical events. A failed duplicate
    check does not block the write: the free/busy read already said FREE.
    """
    existing = _existing_event(event)
    if existing:
        return {"destination": "do:calendar:create", "status": "skipped",
                "note": f"already on the calendar ({existing.get('id')})",
                "event": {"summary": event["summary"], "id": existing.get("id"),
                          "link": existing.get("htmlLink")}}

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
    if event.get("attendees"):
        command += ["--attendees", ",".join(event["attendees"])]
    for reminder in event.get("reminders") or []:
        command += ["--reminder", reminder]
    if event.get("rrule"):
        command += ["--rrule", event["rrule"]]
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
    written = {
        "summary": event["summary"],
        "location": event.get("location"),
        "start": event["start"].isoformat(),
        "end": event["end"].isoformat(),
        "timezone": TIMEZONE,
        "id": created_id,
        "link": link,
        "confidence": event.get("confidence"),
        "extract_usage": event.get("usage"),
    }
    if event.get("attendees"):
        written["attendees"] = ", ".join(event["attendees"])
    if event.get("reminders"):
        written["reminders"] = ", ".join(event["reminders"])
    if event.get("rrule"):
        written["rrule"] = event["rrule"]
    return {
        "destination": "do:calendar:create",
        "status": "created" if not GOG_DRY_RUN else "dry-run",
        "seconds": round(_now() - started, 1),
        "note": f"{event['summary']} · {when}" + (f" · {event['location']}" if event.get("location") else ""),
        "event": written,
    }


def _existing_event(event: dict) -> dict | None:
    """The event already sitting in that window with the same title, or None."""
    env = dict(os.environ)
    env.update(_env_file(GOG_ENV))
    command = ["gog", "calendar", "events", GOG_CALENDAR, "-j",
               "--from", event["start"].isoformat(),
               "--to", event["end"].isoformat()]
    try:
        proc = subprocess.run(command, capture_output=True, text=True, timeout=60, env=env)
        if proc.returncode != 0:
            return None
        payload = json.loads(proc.stdout.strip() or "{}")
    except (subprocess.SubprocessError, OSError, json.JSONDecodeError):
        return None

    wanted = (event["summary"] or "").strip().casefold()
    for candidate in payload.get("events") or []:
        if not isinstance(candidate, dict):
            continue
        if (candidate.get("summary") or "").strip().casefold() == wanted:
            return candidate
    return None


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


# ------------------------------------------------------------------- undo

def delete_event(event_id: str) -> tuple[bool, str]:
    """`gog calendar delete` one event. (ok, detail). Never raises."""
    env = dict(os.environ)
    env.update(_env_file(GOG_ENV))
    command = ["gog", "calendar", "delete", GOG_CALENDAR, event_id, "--force", "-j"]
    if GOG_DRY_RUN:
        command.append("--dry-run")
    try:
        proc = subprocess.run(command, capture_output=True, text=True, timeout=60, env=env)
    except (subprocess.SubprocessError, OSError) as exc:
        return False, f"gog delete not runnable: {exc}"
    if proc.returncode != 0:
        return False, (proc.stderr or proc.stdout or f"exit {proc.returncode}").strip()[-300:]
    return True, "dry-run" if GOG_DRY_RUN else "deleted"


def undo_last_event(log_path: str) -> dict:
    """Delete the newest event this node created that was not undone yet, and log it."""
    created: list[str] = []
    undone: set[str] = set()
    try:
        with open(log_path, encoding="utf-8") as fh:
            for line in fh:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(record.get("undo"), dict) and record["undo"].get("status") == "deleted":
                    undone.add(record["undo"].get("event_id"))
                for route in record.get("routes") or []:
                    if route.get("status") == "created" and route.get("event_id"):
                        created.append(route["event_id"])
    except OSError:
        pass

    target = next((event_id for event_id in reversed(created) if event_id not in undone), None)
    if target is None:
        return {"status": "nothing", "note": "no event created by this node is left to undo"}
    ok, detail = delete_event(target)
    result = {"status": "deleted" if ok and detail == "deleted" else ("dry-run" if ok else "failed"),
              "event_id": target, "note": detail}
    try:
        with open(log_path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "node": NODE_NAME,
                                 "undo": result}) + "\n")
    except OSError:
        pass
    return result


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
    "hint:calendar": hint_calendar,
    "do:calendar:gog": do_calendar_gog,
    "do:calendar:create": do_calendar_create,
}
