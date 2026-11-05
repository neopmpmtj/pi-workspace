"""The reminders table: an append-only JSONL, folded into one row per reminder.

Lines are never edited or removed, only appended, so the laptop and the VPS can
both write and git's union merge (see ~/.pi/.gitattributes) keeps every line.

  {"op": "add",   "id", "ts", "host", "title", "due", "surface", "date_defaulted", "time_defaulted"}
  {"op": "event", "id", "ts", "host", "event_id", "link"}
  {"op": "done",  "id", "ts", "host", "how", "event": "deleted|kept-past|none|delete-failed|dry-run"}
  {"op": "undo",  "id", "ts", "host", "event": ...}

Status: pending after add, done after done, undone after undo. The last op wins.
"""
from __future__ import annotations

import json
import os
import secrets
import socket
from datetime import datetime
from typing import Callable

BASE = os.path.dirname(os.path.abspath(__file__))
# REMINDER_STORE points the table at a scratch file, so a live test never syncs to the other host.
STORE = os.environ.get("REMINDER_STORE") or os.path.join(BASE, "reminders.jsonl")

DeleteEvent = Callable[[str], tuple[bool, str]]


def new_id(now: datetime) -> str:
    return f"r-{now:%Y%m%d}-{secrets.token_hex(2)}"


def append(record: dict, now: datetime, path: str | None = None) -> dict:
    line = {"ts": now.isoformat(timespec="seconds"), "host": socket.gethostname(), **record}
    with open(path or STORE, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(line, ensure_ascii=False) + "\n")
    return line


def read(path: str | None = None) -> list[dict]:
    rows: list[dict] = []
    try:
        with open(path or STORE, encoding="utf-8") as fh:
            for line in fh:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(record, dict) and record.get("id"):
                    rows.append(record)
    except OSError:
        pass
    return rows


def fold(rows: list[dict]) -> dict[str, dict]:
    """One row per reminder id.

    Adds first, then every other op in file order. A union merge may place another
    host's done line above the add it closes, and two hosts' clocks may disagree, so
    neither line order nor ts can be trusted to put an add before its follow-ups.
    """
    table: dict[str, dict] = {}
    for record in rows:
        if record.get("op") == "add":
            rid = record["id"]
            table[rid] = {"id": rid, "title": record.get("title"), "due": record.get("due"),
                          "status": "pending", "created": record.get("ts"), "host": record.get("host"),
                          "event_id": None, "link": None, "closed": None, "how": None}
    for record in rows:
        rid = record["id"]
        op = record.get("op")
        if op == "add" or rid not in table:
            continue
        if op == "event":
            table[rid]["event_id"] = record.get("event_id")
            table[rid]["link"] = record.get("link")
        elif op in ("done", "undo"):
            table[rid]["status"] = "done" if op == "done" else "undone"
            table[rid]["closed"] = record.get("ts")
            table[rid]["how"] = record.get("how") or op
    return table


def listing(all_rows: bool = False, path: str | None = None) -> list[dict]:
    rows = list(fold(read(path)).values())
    if not all_rows:
        rows = [row for row in rows if row["status"] == "pending"]
    return sorted(rows, key=lambda row: (row["status"] != "pending", str(row.get("due") or "")))


def pending(path: str | None = None) -> list[dict]:
    return listing(False, path)


def _close_event(row: dict, now: datetime, delete_event: DeleteEvent) -> str:
    """Delete the calendar event only while it is still ahead; a past one stays as history."""
    if not row.get("event_id"):
        return "none"
    try:
        due = datetime.fromisoformat(str(row.get("due")))
    except ValueError:
        return "kept-past"
    if due <= now:
        return "kept-past"
    ok, detail = delete_event(row["event_id"])
    if not ok:
        return "delete-failed"
    return "dry-run" if detail == "dry-run" else "deleted"


def mark_done(rid: str, how: str, now: datetime, delete_event: DeleteEvent, path: str | None = None) -> dict:
    row = fold(read(path)).get(rid)
    if row is None:
        return {"status": "unknown", "id": rid, "note": f"no reminder {rid}"}
    if row["status"] != "pending":
        return {"status": "unchanged", "id": rid, "title": row["title"], "note": f"{rid} is already {row['status']}"}
    event = _close_event(row, now, delete_event)
    append({"op": "done", "id": rid, "how": how, "event": event}, now, path)
    return {"status": "done", "id": rid, "title": row["title"], "due": row["due"], "event": event,
            "note": f"{rid} · {row['title']} · event {event}"}


def undo_last(now: datetime, delete_event: DeleteEvent, path: str | None = None) -> dict:
    """Withdraw the newest pending reminder: delete its future event and mark it undone."""
    rows = [row for row in fold(read(path)).values() if row["status"] == "pending"]
    if not rows:
        return {"status": "nothing", "note": "no pending reminder to undo"}
    row = max(rows, key=lambda r: str(r.get("created") or ""))
    event = _close_event(row, now, delete_event)
    append({"op": "undo", "id": row["id"], "event": event}, now, path)
    return {"status": "undone", "id": row["id"], "title": row["title"], "event": event,
            "note": f"{row['id']} · {row['title']} · event {event}"}
