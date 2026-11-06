#!/usr/bin/env python3
"""Reminder routing - the VARIABLE part of the `reminder` node.

The arbiter in jev-classifier-multi picks one winner per message; this node acts
when that winner is `reminder` or `reminder_done`.

  do:reminder:log        one cheap model call for the title and the slot, then a
                         row in reminders.jsonl. No time means 06:00; no date means
                         the next occurrence of a stated time (today while it is
                         still ahead, otherwise tomorrow), or tomorrow 06:00 when no
                         time was stated either. Logged first, so a failed write still leaves
                         the reminder in the table.
  do:reminder:calendar   `gog calendar create primary`, 15 minutes, "Reminder: <title>".
                         No free/busy check: 06:00 is chosen because it is free.

Both writes, and the done op, sit behind one switch, WRITES_ENABLED. With it off the node
routes nothing at all: reminders.jsonl gains no line, no event is written, nothing is
closed. JEV still classifies, and the harness leaves the turn to the model.
  do:reminder:done       one cheap model call picks which pending reminder the message
                         closes. Nothing changes unless it names a pending id with
                         confidence >= DONE_MIN_CONFIDENCE. A future event is deleted.
  hint:reminder          the unsure band: nothing runs, the model asks first.
  hint:reminder_done

The gog plumbing (env, duplicate guard, create, delete) is the calendar node's,
loaded by path under another module name so the two `config` modules never clash.
"""
from __future__ import annotations

import importlib.util
import json
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import reminder_store as store

NODE_NAME = "reminder"
NODE_VERSION = "0.1.0"

CLASSIFIER = "~/.pi/jev-classifier/jev-classifier-multi/src/classify.py"
CLASSIFIER_TIMEOUT_S = 45

TIMEZONE = "Europe/Lisbon"
DEFAULT_HOUR = 6
DEFAULT_MINUTES = 15
SUMMARY_PREFIX = "Reminder: "
EXTRACT_MIN_CONFIDENCE = 0.5
DONE_MIN_CONFIDENCE = 0.7
GOG_DRY_RUN = False          # True runs `gog --dry-run` for create and delete

# The deterministic path - the row in reminders.jsonl, the calendar event, the done op - has
# one switch. REMINDER_WRITES=0 (or `route.py --no-writes`, which the harness passes when
# ~/.pi/config.json has reminderNode.writes false) routes nothing at all: nothing is logged,
# no event is written, nothing is closed. JEV still classifies; the turn goes to the model.
WRITES_ENABLED = os.environ.get("REMINDER_WRITES", "1").strip().lower() not in ("0", "false", "off", "no")

_CALENDAR_CONFIG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "calendar", "config.py")
_spec = importlib.util.spec_from_file_location("calendar_config", _CALENDAR_CONFIG)
calendar_config = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(calendar_config)
calendar_config.GOG_DRY_RUN = GOG_DRY_RUN

SECOND_OPINION = calendar_config.SECOND_OPINION


def _local_now() -> datetime:
    return datetime.now(ZoneInfo(TIMEZONE))


def router(row: dict) -> list:
    """Map the arbiter's winner to destination names. Deterministic.

    WRITES_ENABLED false routes nothing, not even the hints: the row, the event and the done
    op are all off, so reminders.jsonl gains no new line. The verdict is still recorded in
    verdicts.jsonl, so what JEV decided stays visible.
    """
    if row.get("abstained"):
        return ["escalate"]
    if not WRITES_ENABLED:
        return []
    winner = row.get("winner") or {}
    kind, band = winner.get("class"), winner.get("band")
    if kind == "reminder_done":
        return ["do:reminder:done"] if band == "act" else (["hint:reminder_done"] if band == "hint" else [])
    if kind == "reminder":
        return ["do:reminder:log", "do:reminder:calendar"] if band == "act" else (
            ["hint:reminder"] if band == "hint" else [])
    return []


# --------------------------------------------------------------- destinations

def _hint(name: str, what: str):
    def handler(row: dict) -> dict:
        confidence = (row.get("winner") or {}).get("confidence")
        sure = f" ({confidence:.2f})" if isinstance(confidence, float) else ""
        return {"destination": name, "status": "hint", "note": f"maybe {what}{sure} - ask before writing"}
    return handler


def do_reminder_log(row: dict) -> dict:
    if not WRITES_ENABLED:
        return {"destination": "do:reminder:log", "status": "skipped",
                "note": "writes off (reminderNode.writes false) - nothing logged"}
    now = _local_now()
    reminder, why = extract_reminder(row.get("utterance", ""), now)
    if reminder is None:
        status = "downgraded" if why.startswith(SECOND_OPINION) else "skipped"
        return {"destination": "do:reminder:log", "status": status, "note": why}

    rid = store.new_id(now)
    store.append({"op": "add", "id": rid, "title": reminder["title"], "due": reminder["start"].isoformat(),
                  "surface": row.get("surface") or "local", "date_defaulted": reminder["date_defaulted"],
                  "time_defaulted": reminder["time_defaulted"]}, now)
    reminder["id"] = rid
    row["logged"] = reminder
    defaults = [label for label, flag in (("date", reminder["date_defaulted"]),
                                          ("time", reminder["time_defaulted"])) if flag]
    return {"destination": "do:reminder:log", "status": "logged",
            "note": f"{rid} · {reminder['title']} · due {reminder['start']:%a %d %b %H:%M}"
                    + (f" · default {' and '.join(defaults)}" if defaults else ""),
            "reminder": {"id": rid, "title": reminder["title"], "due": reminder["start"].isoformat()}}


def do_reminder_calendar(row: dict) -> dict:
    if not WRITES_ENABLED:
        return {"destination": "do:reminder:calendar", "status": "skipped",
                "note": "writes off (reminderNode.writes false) - no event written"}
    reminder = row.get("logged")
    if not isinstance(reminder, dict):
        return {"destination": "do:reminder:calendar", "status": "skipped",
                "note": "nothing logged - no event written"}
    if reminder["start"] < _local_now() - timedelta(minutes=1):
        return {"destination": "do:reminder:calendar", "status": "skipped",
                "note": f"{reminder['start']:%Y-%m-%d %H:%M} is in the past - logged only"}

    event = {"summary": SUMMARY_PREFIX + reminder["title"], "location": None,
             "start": reminder["start"], "end": reminder["start"] + timedelta(minutes=DEFAULT_MINUTES),
             "confidence": reminder["confidence"], "usage": reminder.get("usage")}
    result = calendar_config.create_event(event, row)
    result["destination"] = "do:reminder:calendar"
    written = result.get("event") or {}
    if result.get("status") in ("created", "skipped") and written.get("id"):
        store.append({"op": "event", "id": reminder["id"], "event_id": written["id"],
                      "link": written.get("link")}, _local_now())
    return result


def do_reminder_done(row: dict) -> dict:
    if not WRITES_ENABLED:
        return {"destination": "do:reminder:done", "status": "skipped",
                "note": "writes off (reminderNode.writes false) - nothing closed"}
    open_rows = store.pending()
    if not open_rows:
        return {"destination": "do:reminder:done", "status": "no-match", "note": "no pending reminders"}
    rid, confidence, why = match_pending(row.get("utterance", ""), open_rows)
    if rid is None:
        return {"destination": "do:reminder:done", "status": "no-match", "note": why,
                "pending": [{"id": r["id"], "title": r["title"], "due": r["due"]} for r in open_rows]}
    result = store.mark_done(rid, "natural", _local_now(), calendar_config.delete_event)
    result["destination"] = "do:reminder:done"
    result["note"] = f"{result.get('note')} · match {confidence:.2f}"
    return result


# ----------------------------------------------------------------- the fields

_SYSTEM = (
    "You turn ONE message into ONE reminder. Reply with a single JSON object and nothing else.\n\n"
    "Today is {today}; the local time is {clock}; timezone {tz}.\n\n"
    "Schema:\n"
    '{{"title": "what to be reminded of", "date_local": "YYYY-MM-DD" or null, '
    '"time_local": "HH:MM" or null, "kind": "reminder_request", '
    '"confidence": 0.0, "reason": "one short sentence"}}\n\n'
    "Rules:\n"
    "- The message may be in English, Portuguese, or a mix. Write the title in the "
    "message's language.\n"
    "- title is the task only, imperative, short: no dates, no times, no 'remind me'.\n"
    "- date_local only when the message names a day (tomorrow, Friday, dia 20). A weekday "
    "alone means the next such day. Otherwise null.\n"
    "- time_local only when the message names a time of day (3pm, 15h, at 6). 'in the "
    "morning' is 09:00, 'in the afternoon' is 15:00, 'tonight' is 20:00. Otherwise null.\n"
    "- kind is reminder_request when the message asks to be reminded; calendar_request "
    "when it only asks for an event; other for anything else. Asking to be told a fact "
    "now (remind me what the address is, lembra-me qual é a password) is other.\n"
)


def extract_reminder(text: str, now: datetime) -> tuple[dict | None, str]:
    """One model call -> validated reminder, or (None, why). Never raises."""
    key = calendar_config._env_file(calendar_config.EXTRACT_ENV).get("DEEPSEEK_API_KEY", "")
    if not key:
        return None, f"DEEPSEEK_API_KEY not found in {calendar_config.EXTRACT_ENV}"
    system = _SYSTEM.format(today=now.strftime("%A %Y-%m-%d"), clock=now.strftime("%H:%M"), tz=TIMEZONE)
    body = {"model": calendar_config.EXTRACT_MODEL, "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": text}]}
    try:
        answer, usage = calendar_config._post_json(calendar_config.EXTRACT_URL, body, key,
                                                   calendar_config.EXTRACT_TIMEOUT_S)
        parsed = json.loads(answer)
    except Exception as exc:  # noqa: BLE001 - fail open, never crash the turn
        return None, f"extraction failed: {type(exc).__name__}: {str(exc)[:160]}"
    reminder, why = validate_reminder(parsed, now)
    if reminder is not None:
        reminder["usage"] = usage
    return reminder, why


def validate_reminder(parsed: dict, now: datetime) -> tuple[dict | None, str]:
    """Fill the defaults: no time is DEFAULT_HOUR:00, and no date is the next
    occurrence of a stated time.

    A stated time with no stated date lands today while it is still ahead and rolls to
    tomorrow once it has passed, so "remind me at 9" at 08:21 means today 09:00 while
    "remind me at 9" at 10:00 means tomorrow 09:00. With no time either, the default is
    tomorrow DEFAULT_HOUR:00. A defaulted time that has already passed today moves to
    the next full hour, so "remind me today to..." still lands ahead. A stated date with
    a stated time in the past is kept and the calendar route refuses it; the reminder is
    still logged.
    """
    if not isinstance(parsed, dict):
        return None, "extraction returned no object"
    if parsed.get("kind") != "reminder_request":
        return None, f"{SECOND_OPINION}: the extractor read it as {parsed.get('kind') or 'nothing'}, not reminder_request"
    confidence = parsed.get("confidence")
    if not isinstance(confidence, (int, float)) or confidence < EXTRACT_MIN_CONFIDENCE:
        return None, f"low confidence ({confidence!r})"
    title = str(parsed.get("title") or "").strip()[:120]
    if not title:
        return None, "empty title"

    zone = ZoneInfo(TIMEZONE)
    date_raw, time_raw = parsed.get("date_local"), parsed.get("time_local")
    date_defaulted = not (isinstance(date_raw, str) and date_raw.strip())
    time_defaulted = not (isinstance(time_raw, str) and time_raw.strip())
    try:
        if date_defaulted and not time_defaulted:
            day = now.date()  # a bare clock time means the next such time, not tomorrow
        elif date_defaulted:
            day = (now + timedelta(days=1)).date()
        else:
            day = datetime.strptime(date_raw.strip(), "%Y-%m-%d").date()
    except ValueError:
        return None, f"unparsable date {date_raw!r}"
    try:
        clock = (DEFAULT_HOUR, 0) if time_defaulted else tuple(int(p) for p in time_raw.strip().split(":")[:2])
    except ValueError:
        return None, f"unparsable time {time_raw!r}"
    start = datetime(day.year, day.month, day.day, clock[0], clock[1], tzinfo=zone)
    if time_defaulted and start <= now:
        start = (now + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    elif date_defaulted and start <= now:
        next_day = day + timedelta(days=1)
        start = datetime(next_day.year, next_day.month, next_day.day,
                         clock[0], clock[1], tzinfo=zone)
    return {"title": title, "start": start, "confidence": float(confidence),
            "date_defaulted": date_defaulted, "time_defaulted": time_defaulted}, ""


_MATCH_SYSTEM = (
    "The user says a task is done. Pick which pending reminder it closes. Reply with a "
    "single JSON object and nothing else.\n\n"
    'Schema: {{"id": "r-..." or null, "confidence": 0.0, "reason": "one short sentence"}}\n\n'
    "Pending reminders:\n{pending}\n\n"
    "Rules: the message may be in English, Portuguese, or a mix. Return null when no "
    "reminder clearly matches or when several could.\n"
)


def match_pending(text: str, open_rows: list[dict]) -> tuple[str | None, float, str]:
    """(id, confidence, why). id is None unless one pending reminder clearly matches."""
    key = calendar_config._env_file(calendar_config.EXTRACT_ENV).get("DEEPSEEK_API_KEY", "")
    if not key:
        return None, 0.0, f"DEEPSEEK_API_KEY not found in {calendar_config.EXTRACT_ENV}"
    listing = "\n".join(f"- {r['id']}: {r['title']} (due {r['due']})" for r in open_rows)
    body = {"model": calendar_config.EXTRACT_MODEL, "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": _MATCH_SYSTEM.format(pending=listing)},
                         {"role": "user", "content": text}]}
    try:
        answer, _ = calendar_config._post_json(calendar_config.EXTRACT_URL, body, key,
                                               calendar_config.EXTRACT_TIMEOUT_S)
        parsed = json.loads(answer)
    except Exception as exc:  # noqa: BLE001
        return None, 0.0, f"match failed: {type(exc).__name__}: {str(exc)[:160]}"
    return pick_match(parsed, open_rows)


def pick_match(parsed: object, open_rows: list[dict]) -> tuple[str | None, float, str]:
    if not isinstance(parsed, dict):
        return None, 0.0, "match returned no object"
    rid = parsed.get("id")
    confidence = parsed.get("confidence")
    confidence = float(confidence) if isinstance(confidence, (int, float)) else 0.0
    if rid not in {r["id"] for r in open_rows}:
        return None, confidence, f"no pending reminder matched ({parsed.get('reason') or 'no reason'})"
    if confidence < DONE_MIN_CONFIDENCE:
        return None, confidence, f"unsure which reminder ({confidence:.2f})"
    return rid, confidence, ""


def mark_done_by_id(rid: str) -> dict:
    return store.mark_done(rid, "command", _local_now(), calendar_config.delete_event)


def undo_last() -> dict:
    return store.undo_last(_local_now(), calendar_config.delete_event)


DESTINATIONS = {
    "hint:reminder": _hint("hint:reminder", "a reminder"),
    "hint:reminder_done": _hint("hint:reminder_done", "a finished reminder"),
    "do:reminder:log": do_reminder_log,
    "do:reminder:calendar": do_reminder_calendar,
    "do:reminder:done": do_reminder_done,
}
