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

Both store writes, and the done op, sit behind one exclusive writer: store, tasks, or off.
With it off the node routes nothing at all: reminders.jsonl gains no line, no event is
written, nothing is closed, and Google Tasks is not touched. JEV still classifies, and the
harness leaves the turn to the model.
  do:reminder:done       one cheap model call picks which pending reminder the message
                         closes. Nothing changes unless it names a pending id with
                         confidence >= DONE_MIN_CONFIDENCE. A future event is deleted.
  do:reminder:tasks      writer tasks: parsed title and due -> `gog tasks add` on the
                         Reminders list. No jsonl, no calendar event.
  do:reminder:tasks-done writer tasks: match an open task on that list, then `gog tasks done`.
  hint:reminder          the unsure band: nothing runs, the model asks first.
  hint:reminder_done

The gog plumbing (env, duplicate guard, create, delete) is the calendar node's,
loaded by path under another module name so the two `config` modules never clash.
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import reminder_store as store

NODE_NAME = "reminder"
NODE_VERSION = "0.2.0"

CLASSIFIER = "~/.pi/jev-classifier/jev-classifier-multi/src/classify.py"
CLASSIFIER_TIMEOUT_S = 45

TIMEZONE = "Europe/Lisbon"
DEFAULT_HOUR = 6
DEFAULT_MINUTES = 15
SUMMARY_PREFIX = "Reminder: "
EXTRACT_MIN_CONFIDENCE = 0.5
DONE_MIN_CONFIDENCE = 0.7
GOG_DRY_RUN = False          # True runs `gog --dry-run` for create and delete

# One exclusive writer. store = reminders.jsonl + calendar; tasks = gog tasks on the
# Reminders list; off = classify only. REMINDER_WRITER wins; REMINDER_WRITES=0 still
# means off (`route.py --no-writes` / a missing writer). A hand run with no flag stays
# on store, so the shell does not follow config.json.
_WRITERS = ("store", "tasks", "off")
TASKS_LIST_TITLE = "Reminders"


def _writer_from_env() -> str:
    named = os.environ.get("REMINDER_WRITER")
    if isinstance(named, str) and named.strip().lower() in _WRITERS:
        return named.strip().lower()
    if os.environ.get("REMINDER_WRITES", "1").strip().lower() in ("0", "false", "off", "no"):
        return "off"
    return "store"


WRITER = _writer_from_env()


def set_writer(name: str) -> None:
    global WRITER
    text = (name or "").strip().lower()
    WRITER = text if text in _WRITERS else "off"


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

    writer off (or any other value) routes nothing, not even the hints: the row, the event,
    the Tasks write and the done op are all off. The verdict is still recorded in
    verdicts.jsonl, so what JEV decided stays visible.
    """
    if row.get("abstained"):
        return ["escalate"]
    if WRITER not in ("store", "tasks"):
        return []
    winner = row.get("winner") or {}
    kind, band = winner.get("class"), winner.get("band")
    if kind == "reminder_done":
        if band == "act":
            return ["do:reminder:done"] if WRITER == "store" else ["do:reminder:tasks-done"]
        return ["hint:reminder_done"] if band == "hint" else []
    if kind == "reminder":
        if band == "act":
            return ["do:reminder:log", "do:reminder:calendar"] if WRITER == "store" else ["do:reminder:tasks"]
        return ["hint:reminder"] if band == "hint" else []
    return []


# --------------------------------------------------------------- destinations

def _hint(name: str, what: str):
    def handler(row: dict) -> dict:
        confidence = (row.get("winner") or {}).get("confidence")
        sure = f" ({confidence:.2f})" if isinstance(confidence, float) else ""
        return {"destination": name, "status": "hint", "note": f"maybe {what}{sure} - ask before writing"}
    return handler


def do_reminder_log(row: dict) -> dict:
    if WRITER != "store":
        return {"destination": "do:reminder:log", "status": "skipped",
                "note": f"writer {WRITER} - nothing logged"}
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
    if WRITER != "store":
        return {"destination": "do:reminder:calendar", "status": "skipped",
                "note": f"writer {WRITER} - no event written"}
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
    if WRITER != "store":
        return {"destination": "do:reminder:done", "status": "skipped",
                "note": f"writer {WRITER} - nothing closed"}
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


def do_reminder_tasks(row: dict) -> dict:
    """Parse the reminder, then `gog tasks add` on the Reminders list. No jsonl, no event."""
    if WRITER != "tasks":
        return {"destination": "do:reminder:tasks", "status": "skipped",
                "note": f"writer {WRITER} - no task written"}
    now = _local_now()
    reminder, why = extract_reminder(row.get("utterance", ""), now)
    if reminder is None:
        status = "downgraded" if why.startswith(SECOND_OPINION) else "skipped"
        return {"destination": "do:reminder:tasks", "status": status, "note": why}

    list_id, list_why = tasks_list_id()
    if list_id is None:
        return {"destination": "do:reminder:tasks", "status": "failed", "note": list_why}

    existing = _open_task_with_title(list_id, reminder["title"])
    if existing:
        return {"destination": "do:reminder:tasks", "status": "skipped",
                "note": f"already on Tasks ({existing['id']})",
                "task": existing}

    due = reminder["start"].date().isoformat()
    notes = f"due {reminder['start']:%H:%M} {TIMEZONE}"
    code, out, err = _gog_tasks("add", list_id, "--title", reminder["title"],
                                "--due", due, "--notes", notes, write=True)
    if code != 0:
        detail = (err or out or f"exit {code}").strip()[-300:]
        return {"destination": "do:reminder:tasks", "status": "failed",
                "note": f"gog tasks add failed: {detail}"}
    created_id = _gog_id(_gog_payload(out))
    status = "dry-run" if calendar_config.GOG_DRY_RUN else "created"
    defaults = [label for label, flag in (("date", reminder["date_defaulted"]),
                                          ("time", reminder["time_defaulted"])) if flag]
    task = {"id": created_id, "title": reminder["title"], "due": reminder["start"].isoformat(),
            "list_id": list_id}
    return {"destination": "do:reminder:tasks", "status": status,
            "note": f"{reminder['title']} · due {reminder['start']:%a %d %b %H:%M}"
                    + (f" · default {' and '.join(defaults)}" if defaults else ""),
            "task": task}


def do_reminder_tasks_done(row: dict) -> dict:
    """Match an open task on the Reminders list, then `gog tasks done`."""
    if WRITER != "tasks":
        return {"destination": "do:reminder:tasks-done", "status": "skipped",
                "note": f"writer {WRITER} - nothing closed"}
    list_id, list_why = tasks_list_id()
    if list_id is None:
        return {"destination": "do:reminder:tasks-done", "status": "failed", "note": list_why}
    open_rows = _open_tasks(list_id)
    if not open_rows:
        return {"destination": "do:reminder:tasks-done", "status": "no-match",
                "note": "no open tasks on Reminders"}
    rid, confidence, why = match_pending(row.get("utterance", ""), open_rows)
    if rid is None:
        return {"destination": "do:reminder:tasks-done", "status": "no-match", "note": why,
                "pending": [{"id": r["id"], "title": r["title"], "due": r["due"]} for r in open_rows]}
    matched = next(r for r in open_rows if r["id"] == rid)
    code, out, err = _gog_tasks("done", list_id, rid, write=True)
    if code != 0:
        detail = (err or out or f"exit {code}").strip()[-300:]
        return {"destination": "do:reminder:tasks-done", "status": "failed",
                "note": f"gog tasks done failed: {detail}", "id": rid, "title": matched["title"]}
    status = "dry-run" if calendar_config.GOG_DRY_RUN else "done"
    return {"destination": "do:reminder:tasks-done", "status": status, "id": rid,
            "title": matched["title"],
            "note": f"{rid} · {matched['title']} · match {confidence:.2f}"}


def _gog_tasks(*args: str, write: bool = False) -> tuple[int, str, str]:
    env = dict(os.environ)
    env.update(calendar_config._env_file(calendar_config.GOG_ENV))
    command = ["gog", "tasks", *args, "-j", "--no-input"]
    if write and calendar_config.GOG_DRY_RUN:
        command.append("--dry-run")
    try:
        proc = subprocess.run(command, capture_output=True, text=True, timeout=60, env=env)
    except subprocess.TimeoutExpired:
        return 124, "", "gog tasks timed out"
    except OSError as exc:
        return 127, "", f"gog not runnable: {exc}"
    return proc.returncode, proc.stdout, proc.stderr


def _gog_payload(stdout: str):
    try:
        return json.loads(stdout.strip() or "{}")
    except json.JSONDecodeError:
        return None


def _gog_items(payload) -> list[dict]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("items", "lists", "tasks", "tasklists"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    if payload.get("id"):
        return [payload]
    return []


def _gog_id(payload) -> str | None:
    if isinstance(payload, dict):
        for key in ("task", "list", "tasklist", "item"):
            inner = payload.get(key)
            if isinstance(inner, dict) and inner.get("id"):
                return str(inner["id"])
        if payload.get("id"):
            return str(payload["id"])
    return None


def tasks_list_id() -> tuple[str | None, str]:
    """Id of the Reminders task list, creating it when missing. Never raises."""
    code, out, err = _gog_tasks("lists")
    if code != 0:
        return None, f"gog tasks lists failed: {(err or out).strip()[-300:]}"
    wanted = TASKS_LIST_TITLE.casefold()
    for item in _gog_items(_gog_payload(out)):
        title = str(item.get("title") or item.get("name") or "").strip()
        if title.casefold() == wanted and item.get("id"):
            return str(item["id"]), ""
    code, out, err = _gog_tasks("lists", "create", "--title", TASKS_LIST_TITLE, write=True)
    if code != 0:
        return None, f"gog tasks lists create failed: {(err or out).strip()[-300:]}"
    created = _gog_id(_gog_payload(out))
    if not created:
        return None, "gog tasks lists create printed no id"
    return created, ""


def _open_tasks(list_id: str) -> list[dict]:
    code, out, err = _gog_tasks("list", list_id)
    if code != 0:
        return []
    rows = []
    for item in _gog_items(_gog_payload(out)):
        if str(item.get("status") or "").casefold() == "completed":
            continue
        task_id = item.get("id")
        title = str(item.get("title") or "").strip()
        if not task_id or not title:
            continue
        rows.append({"id": str(task_id), "title": title, "due": str(item.get("due") or "")})
    return rows


def _open_task_with_title(list_id: str, title: str) -> dict | None:
    wanted = title.strip().casefold()
    for item in _open_tasks(list_id):
        if item["title"].casefold() == wanted:
            return item
    return None


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
    "do:reminder:tasks": do_reminder_tasks,
    "do:reminder:tasks-done": do_reminder_tasks_done,
}
