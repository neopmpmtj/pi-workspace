#!/usr/bin/env python3
"""reminder node - the INVARIANT caller: text -> verdict -> routes -> effects.

Same steps as the calendar node, in the same order:

  clean()      strip the harness markup pi adds ([telegram], [time], [voice])
  classify()   ONE JEV request through jev-classifier-multi, or the payload the
               harness already fetched (--classifier-json)
  verdict()    that JSON -> this node's row, including the arbiter's winner
  route()      config.router(row) -> destination names
  execute()    call each destination's handler from config.DESTINATIONS
  log()        append metadata to verdicts.jsonl (never the text)

The reminders themselves live in reminders.jsonl (reminder_store.py), which is
tracked in git; verdicts.jsonl is not.

FAIL OPEN. No verdict, no routes, exit 2, and the turn happens as usual.

Usage
  route.py --text "Remind me to buy milk"                    classify, route, run
  route.py --text "..." --dry-run                            stop after routing
  route.py --text "..." --json                               one JSON object
  route.py --text "..." --classifier-json payload.json       reuse one classification
  route.py --text "..." --no-writes                          route nothing, write nothing
  route.py --list [--all] [--json]                           the reminders table
  route.py --done r-20261105-ab12 [--json]                   mark one done
  route.py --undo [--json]                                   withdraw the newest pending one

Exit 0 when a verdict was produced (match or not); 2 when none exists.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config  # noqa: E402
import reminder_store as store  # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
VERDICTS = os.path.join(BASE, "verdicts.jsonl")

# Kept in step with calendar/route.py:clean. Duplicated, not imported: importing that
# file would put its directory, and its `config`, ahead of this node's own.
_HARNESS_LINE = re.compile(r"(?m)^\s*\[(time|voice)\][^\n]*$", re.I)
_HARNESS_INLINE = re.compile(r"(?mi)^\s*\[(telegram|tui)\]\s*")
_HARNESS_ANY = re.compile(r"\[(time|voice|telegram|tui)\][^\n]*", re.I)
_TELEGRAM = re.compile(r"^\s*\[telegram", re.I)


def clean(raw: str) -> str:
    t = _HARNESS_LINE.sub("", raw or "")
    t = _HARNESS_INLINE.sub("", t)
    t = _HARNESS_ANY.sub(" ", t)
    t = " ".join(line.strip() for line in t.splitlines() if line.strip())
    return re.sub(r"\s{2,}", " ", t).strip()


def classify(text: str) -> tuple[dict | None, str | None, int | None]:
    cli = os.path.expanduser(config.CLASSIFIER)
    started = time.time()
    try:
        proc = subprocess.run([sys.executable, cli, "--json", text],
                              capture_output=True, text=True, timeout=config.CLASSIFIER_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        return None, f"classifier timeout after {config.CLASSIFIER_TIMEOUT_S}s", None
    except OSError as exc:
        return None, f"classifier not runnable: {exc}", None
    elapsed = round((time.time() - started) * 1000)
    if proc.returncode != 0:
        return None, (proc.stderr or f"exit {proc.returncode}").strip()[-300:], elapsed
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        return None, f"classifier printed no JSON: {exc}", elapsed
    if not isinstance(payload, dict) or "classes" not in payload:
        return None, "classifier JSON has no classes", elapsed
    return payload, None, elapsed


def read_classification(path: str) -> tuple[dict | None, str | None, int | None]:
    try:
        with open(path, encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        return None, f"classifier JSON unreadable: {exc}", None
    if not isinstance(payload, dict) or "classes" not in payload:
        return None, "classifier JSON has no classes", None
    latency = payload.get("latency_ms")
    return payload, None, latency if isinstance(latency, int) else None


def verdict(text: str, payload: dict | None, error: str | None, latency_ms: int | None = None) -> dict:
    row = {"node": config.NODE_NAME, "node_version": config.NODE_VERSION, "utterance": text,
           "utterance_chars": len(text), "abstained": True, "reason": None, "reminder": None,
           "reminder_done": None, "winner": None, "model": None, "latency_ms": None, "routes": []}
    if error or not payload:
        row["reason"] = f"classifier_error: {error}"
        return row
    classes = payload.get("classes") or {}
    winner = payload.get("winner")
    if "reminder" not in classes or "reminder_done" not in classes:
        row["reason"] = "classifier JSON has no reminder classes"
        return row
    if not isinstance(winner, dict) or "class" not in winner:
        row["reason"] = "classifier JSON has no winner"
        return row
    row["abstained"] = False
    for name in ("reminder", "reminder_done"):
        block = classes[name]
        row[name] = {"is_match": bool(block.get("is_match")), "confidence": block.get("confidence")}
    row["winner"] = {key: winner.get(key) for key in ("class", "confidence", "band", "vetoed_by", "capped_by")}
    row["model"] = payload.get("model")
    row["latency_ms"] = latency_ms
    return row


def execute(row: dict, destinations: list, dry_run: bool) -> list:
    """In order; each destination sees the ones before it (the calendar write reads the log row)."""
    results: list = []
    row["routes"] = results
    for name in destinations:
        if name == "escalate":
            results.append({"destination": name, "status": "no-op", "note": "fail open - nothing routed"})
            continue
        handler = config.DESTINATIONS.get(name)
        if handler is None:
            results.append({"destination": name, "status": "unknown"})
            continue
        if dry_run and not name.startswith("hint:"):
            results.append({"destination": name, "status": "skipped (dry run)"})
            continue
        started = time.time()
        try:
            result = handler(row)
        except Exception as exc:  # noqa: BLE001 - a destination must not kill the turn
            results.append({"destination": name, "status": "failed", "error": repr(exc)})
            continue
        result.setdefault("seconds", round(time.time() - started, 1))
        results.append(result)
    return results


LOG_KEYS = ("node", "node_version", "utterance_chars", "abstained", "reason",
            "reminder", "reminder_done", "winner", "model", "latency_ms", "routes")


def log(row: dict) -> None:
    record = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    record.update({k: row.get(k) for k in LOG_KEYS})
    record["routes"] = [{"destination": r.get("destination"), "status": r.get("status"),
                         "note": (r.get("note") or r.get("error") or "")[:160]}
                        for r in row.get("routes") or []]
    try:
        with open(VERDICTS, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError:
        pass


def print_human(row: dict) -> None:
    if row.get("abstained"):
        print("reminder            no verdict")
        print(f"reason              {row.get('reason')}")
        return
    winner = row.get("winner") or {}
    confidence = winner.get("confidence")
    print(f"winner              {winner.get('class')}  band {winner.get('band')}"
          + (f"  confidence {confidence:.3f}" if isinstance(confidence, float) else ""))
    for name in ("reminder", "reminder_done"):
        block = row.get(name) or {}
        print(f"{name:<20}{'true' if block.get('is_match') else 'false'} {block.get('confidence') or 0:.3f}")
    print(f"model               {row.get('model')}   latency {row.get('latency_ms')} ms")
    print()
    print("routes")
    if not row["routes"]:
        print("  none - ordinary turn")
    for r in row["routes"]:
        bits = [r.get("note") or r.get("error"), f"{r['seconds']} s" if r.get("seconds") is not None else None]
        detail = " · ".join(str(b) for b in bits if b)
        print(f"  {r['destination']:<21} {r['status']:<10} {detail}".rstrip())
    print()
    print("phrase")
    print(f"  {row.get('utterance')}")


def print_table(rows: list[dict]) -> None:
    if not rows:
        print("no reminders")
        return
    print(f"{'id':<16} {'status':<8} {'due':<17} title")
    for row in rows:
        due = str(row.get("due") or "")[:16].replace("T", " ")
        print(f"{row['id']:<16} {row['status']:<8} {due:<17} {row.get('title') or ''}")


def emit(result, as_json: bool, human) -> None:
    if as_json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        human(result)


def main() -> int:
    ap = argparse.ArgumentParser(description="route one utterance through the reminder node")
    ap.add_argument("--text", default=None)
    ap.add_argument("--stdin", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="classify and route, run nothing")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--no-log", action="store_true")
    ap.add_argument("--classifier-json", default=None)
    ap.add_argument("--no-writes", action="store_true",
                    help="route and write nothing: no log row, no event (same as REMINDER_WRITES=0)")
    ap.add_argument("--list", action="store_true", help="print the reminders table")
    ap.add_argument("--all", action="store_true", help="with --list: include done and undone")
    ap.add_argument("--done", default=None, metavar="ID", help="mark one reminder done")
    ap.add_argument("--undo", action="store_true", help="withdraw the newest pending reminder")
    args = ap.parse_args()

    if args.no_writes:
        config.WRITES_ENABLED = False

    if args.list:
        emit(store.listing(args.all), args.json, print_table)
        return 0
    if args.done:
        result = config.mark_done_by_id(args.done.strip())
        emit(result, args.json, lambda r: print(f"{r['status']} · {r['note']}"))
        return 0 if result["status"] in ("done", "unchanged") else 1
    if args.undo:
        result = config.undo_last()
        emit(result, args.json, lambda r: print(f"{r['status']} · {r['note']}"))
        return 0 if result["status"] in ("undone", "nothing") else 1

    raw = sys.stdin.read() if (args.stdin or args.text is None) else args.text
    text = clean(raw)
    if not text:
        print("error: empty utterance", file=sys.stderr)
        return 2

    if args.classifier_json:
        payload, error, latency_ms = read_classification(args.classifier_json)
    else:
        payload, error, latency_ms = classify(text)
    row = verdict(text, payload, error, latency_ms)
    row["surface"] = "telegram" if _TELEGRAM.search(raw or "") else "local"
    row["routes"] = execute(row, config.router(row) if not row["abstained"] else ["escalate"],
                            dry_run=args.dry_run)
    if not args.no_log:
        log(row)

    row.pop("utterance", None)
    logged = row.pop("logged", None)
    if isinstance(logged, dict):
        row["logged"] = {"id": logged.get("id"), "title": logged.get("title"),
                         "due": logged["start"].isoformat()}
    if args.json:
        print(json.dumps(row, ensure_ascii=False, default=str))
    else:
        row["utterance"] = text
        print_human(row)
    return 2 if row["abstained"] else 0


if __name__ == "__main__":
    sys.exit(main())
