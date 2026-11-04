#!/usr/bin/env python3
"""calendar node - the INVARIANT caller: text -> verdict -> routes -> effects.

One function per step, in the order they run:

  clean()      strip the harness markup pi adds ([telegram], [time], [voice])
  classify()   ONE JEV request through the jev-classifier-multi CLI
  verdict()    that JSON -> this node's row
  route()      config.router(row) -> destination names
  execute()    call each destination's handler from config.DESTINATIONS
  log()        append metadata to verdicts.jsonl (never the text)

Nothing in this file knows what a destination does; nothing in config.py knows
how it is called.

FAIL OPEN. A missing key, a timeout, a malformed answer: no verdict, no routes,
exit 2, and the turn happens as if this node did not exist.

Usage
  route.py --text "Lunch at Cafe Nero on Friday at 1pm"     classify, route, run
  route.py --text "..." --dry-run                           stop after routing
  route.py --text "..." --json                              one JSON object
  printf '%s' "..." | route.py --stdin

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

BASE = os.path.dirname(os.path.abspath(__file__))
VERDICTS = os.path.join(BASE, "verdicts.jsonl")


# ------------------------------------------------------------------ step 1
# Kept in step with `scheduler/core.py:clean`, which is the same strip for the
# same reason: pi prefixes a turn with surface markup that is not the speaker's
# words. Duplicated here rather than imported, because importing that module
# puts its directory on sys.path ahead of this node's own `config`.
_HARNESS_LINE = re.compile(r"(?m)^\s*\[(time|voice)\][^\n]*$", re.I)
_HARNESS_INLINE = re.compile(r"(?mi)^\s*\[(telegram|tui)\]\s*")
_HARNESS_ANY = re.compile(r"\[(time|voice|telegram|tui)\][^\n]*", re.I)


def clean(raw: str) -> str:
    t = _HARNESS_LINE.sub("", raw or "")
    t = _HARNESS_INLINE.sub("", t)
    t = _HARNESS_ANY.sub(" ", t)
    t = " ".join(line.strip() for line in t.splitlines() if line.strip())
    return re.sub(r"\s{2,}", " ", t).strip()


# ------------------------------------------------------------------ step 2
def classify(text: str) -> tuple[dict | None, str | None, int | None]:
    """One request, every class, through the measured CLI. Never raises."""
    cli = os.path.expanduser(config.CLASSIFIER)
    started = time.time()
    try:
        proc = subprocess.run(
            [sys.executable, cli, "--json", text],
            capture_output=True, text=True, timeout=config.CLASSIFIER_TIMEOUT_S,
        )
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


# ------------------------------------------------------------------ step 3
def verdict(text: str, payload: dict | None, error: str | None,
            latency_ms: int | None = None) -> dict:
    row = {
        "node": config.NODE_NAME,
        "node_version": config.NODE_VERSION,
        "utterance": text,          # in memory only; log() drops it
        "utterance_chars": len(text),
        "abstained": True,
        "reason": None,
        "calendar": None,
        "model": None,
        "latency_ms": None,
        "usage": None,
        "routes": [],
    }
    if error or not payload:
        row["reason"] = f"classifier_error: {error}"
        return row

    block = (payload.get("classes") or {}).get("calendar") or {}
    if "is_match" not in block:
        row["reason"] = "classifier JSON has no calendar class"
        return row

    row["abstained"] = False
    row["calendar"] = {
        "is_match": bool(block.get("is_match")),
        "confidence": block.get("confidence"),
        "decision": block.get("decision"),
        "threshold": block.get("threshold"),
        "rules": {name: rule.get("noul") for name, rule in (block.get("rules") or {}).items()},
    }
    row["model"] = payload.get("model")
    row["latency_ms"] = latency_ms
    row["usage"] = payload.get("usage")
    return row


# ------------------------------------------------------------------ step 4
def route(row: dict) -> list:
    return config.router(row)


# ------------------------------------------------------------------ step 5
def execute(row: dict, destinations: list, dry_run: bool) -> list:
    """Run the destinations in order. Each one sees the results of those before it.

    That ordering IS the chain: `do:calendar:create` reads `do:calendar:gog`'s answer
    out of `row["routes"]`, so the read must be listed first and its result must be
    visible while the write runs. The list is shared, not copied, on purpose.
    """
    results: list = []
    row["routes"] = results
    for name in destinations:
        if name == "escalate":
            results.append({"destination": name, "status": "no-op",
                            "note": "fail open - nothing routed"})
            continue
        handler = config.DESTINATIONS.get(name)
        if handler is None:
            results.append({"destination": name, "status": "unknown"})
            continue
        if dry_run:
            results.append({"destination": name, "status": "skipped (dry run)"})
            continue
        started = time.time()
        try:
            result = handler(row)
        except Exception as exc:  # noqa: BLE001 - a destination must not kill the turn
            results.append({"destination": name, "status": "failed", "error": repr(exc)})
            continue
        if result is None:
            results.append({"destination": name, "status": "stub",
                            "note": "not implemented - next unit"})
        else:
            result.setdefault("seconds", round(time.time() - started, 1))
            results.append(result)
    return results


# ------------------------------------------------------------------ step 6
LOG_KEYS = ("node", "node_version", "utterance_chars", "abstained", "reason",
            "calendar", "model", "latency_ms", "routes")


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
        pass  # a log that cannot be written is not a reason to fail a turn


# ------------------------------------------------------------------ printing
def print_human(row: dict) -> None:
    calendar = row.get("calendar")
    if row.get("abstained"):
        print("calendar            no verdict")
        print(f"reason              {row.get('reason')}")
        return

    nums = calendar.get("rules") or {}
    print(f"calendar            {'true' if calendar['is_match'] else 'false'}")
    print(f"confidence          {calendar['confidence']:.3f}")
    print(f"decision            {calendar['decision']}")
    print(f"threshold           {calendar['threshold']}")
    print("rules               " + " · ".join(f"{k} {v:.3f}" if isinstance(v, float) else f"{k} {v}"
                                              for k, v in nums.items()))
    print(f"model               {row.get('model')}   latency {row.get('latency_ms')} ms")
    print()
    print("routes")
    if not row["routes"]:
        print("  none - ordinary turn")
    for r in row["routes"]:
        bits = [r.get("note") or r.get("error"),
                r.get("source") or r.get("agent"),
                f"{r['seconds']} s" if r.get("seconds") is not None else None]
        detail = " · ".join(str(b) for b in bits if b)
        print(f"  {r['destination']:<21} {r['status']:<8} {detail}".rstrip())
    print()
    print("phrase")
    print(f"  {row.get('utterance')}")
    for r in row["routes"]:
        if r.get("answer"):
            print()
            print(f"answer from {r['destination']}")
            for line in r["answer"].splitlines():
                print(f"  {line}")
        if r.get("event") and r.get("status") in ("created", "dry-run"):
            event = r["event"]
            print()
            print(f"event written by {r['destination']}")
            for key in ("summary", "location", "start", "end", "id", "link"):
                if event.get(key):
                    print(f"  {key:<9} {event[key]}")


def main() -> int:
    ap = argparse.ArgumentParser(description="route one utterance through the calendar node")
    ap.add_argument("--text", default=None)
    ap.add_argument("--stdin", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="classify and route, run nothing")
    ap.add_argument("--json", action="store_true", help="print the row instead of the report")
    ap.add_argument("--no-log", action="store_true")
    args = ap.parse_args()

    raw = sys.stdin.read() if (args.stdin or args.text is None) else args.text
    text = clean(raw)

    if not text:
        print("error: empty utterance", file=sys.stderr)
        return 2

    payload, error, latency_ms = classify(text)
    row = verdict(text, payload, error, latency_ms)
    row["routes"] = execute(row, route(row) if not row["abstained"] else ["escalate"],
                            dry_run=args.dry_run)
    if not args.no_log:
        log(row)

    row.pop("utterance", None)
    row.pop("event", None)   # datetimes resolved by the read; the routes report them
    if args.json:
        print(json.dumps(row, ensure_ascii=False))
    else:
        row["utterance"] = text
        print_human(row)
    return 2 if row["abstained"] else 0


if __name__ == "__main__":
    sys.exit(main())
