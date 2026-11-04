#!/usr/bin/env python3
"""intake sweeper - observe-only.

Consumes utterances the harness ALREADY captures, rather than hooking the turn.
That choice buys four things:

  * no latency added to any turn
  * it cannot break a turn by failing
  * it does not compete with the existing input-capture listener
  * it is observe-only by ARCHITECTURE, not by discipline

Source:   ~/.pi/dbs/user-inputs.sqlite          (read-only)
Context:  ~/.pi/agent/sessions/**/*<session>.jsonl   (only for the `act` axis)
Output:   verdicts.jsonl  - metadata only, no utterance text

Nothing is ever routed on. Exit code is 0 even when the classifier fails:
fail-open is the contract.

Usage:
  python3 sweep.py --dry-run          # show what would be processed
  python3 sweep.py --limit 5          # process a few
  python3 sweep.py                    # process everything new, append verdicts
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core  # noqa: E402
import config  # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB = os.path.expanduser("~/.pi/dbs/user-inputs.sqlite")
DEFAULT_OUT = os.path.join(BASE, "verdicts.jsonl")


def load_done(path: str) -> set:
    """Row ids already judged. The log is append-only, so this is the cursor."""
    done = set()
    if not os.path.exists(path):
        return done
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:  # noqa: BLE001
                continue
            if rec.get("source_row_id") is not None:
                done.add(rec["source_row_id"])
    return done


def fetch(db_path: str, since: str | None, only_ids: list | None):
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    sql = ("select id, created_at, session_id, surface, prompt_text "
           "from user_inputs")
    params: list = []
    where = []
    if since:
        where.append("created_at >= ?")
        params.append(since)
    if only_ids:
        where.append(f"id in ({','.join('?' * len(only_ids))})")
        params.extend(only_ids)
    if where:
        sql += " where " + " and ".join(where)
    sql += " order by id"
    try:
        return con.execute(sql, params).fetchall()
    finally:
        con.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="intake sweeper (observe-only)")
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--limit", type=int, default=0, help="0 = all")
    ap.add_argument("--since", default=None, help="ISO timestamp lower bound")
    ap.add_argument("--ids", default=None, help="comma-separated row ids (recheck)")
    ap.add_argument("--recheck", action="store_true", help="re-judge rows already in --out")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--silent", action="store_true",
                    help="say nothing unless work was done or something failed (for timers)")
    args = ap.parse_args()

    if args.silent:
        args.quiet = True

    def say(*parts):
        if not args.silent:
            print(*parts)

    if not os.path.exists(args.db):
        print(f"FATAL: capture database not found: {args.db}", file=sys.stderr)
        return 2

    only_ids = [int(x) for x in args.ids.split(",")] if args.ids else None
    done = set() if args.recheck else load_done(args.out)
    rows = fetch(args.db, args.since, only_ids)
    todo = [r for r in rows if r[0] not in done]
    if args.limit:
        todo = todo[:args.limit]

    say(f"capture rows: {len(rows)}   already judged: {len(rows) - len([r for r in rows if r[0] not in done])}"
        f"   to process: {len(todo)}")

    if args.dry_run:
        for rid, ts, sid, surface, raw in todo:
            c = core.clean(raw)
            ctx = core.prior_exchange(sid, ts)
            print(f"  id={rid:<5} {surface:<8} {len(raw):>5}->{len(c):<5} chars  ctx={len(ctx):>4}  {c[:60]!r}")
        print("dry run - nothing called, nothing written")
        return 0

    if not todo:
        say("nothing to do")
        return 0

    try:
        resolved = core.resolve_model()
    except core.ClassifierError as exc:
        # fail open: a missing key means nothing routes, which is the safe state
        print(f"FATAL: {exc}", file=sys.stderr)
        return 2

    gates = [n for n, s in config.QUESTIONS.items() if s.get("role") == "gate"]
    facets = [n for n, s in config.QUESTIONS.items() if s.get("role") == "facet"]
    say(f"provider={resolved['provider']} model={resolved['model']} "
        f"questions={len(config.QUESTIONS)} gates={gates} facets={len(facets)}\n")

    written = abstained = failed = 0
    started = time.time()
    with open(args.out, "a", encoding="utf-8") as out:
        for i, (rid, ts, sid, surface, raw) in enumerate(todo, 1):
            utterance = core.clean(raw)
            context = core.prior_exchange(sid, ts)
            row = core.to_verdict(utterance, context, row_id=rid, resolved=resolved)
            row["at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            row["captured_at"] = ts
            row["surface"] = surface
            row["context_chars"] = len(context)

            out.write(json.dumps(row, ensure_ascii=False) + "\n")
            out.flush()
            written += 1
            if row.get("abstained"):
                abstained += 1
                if row.get("reason", "").startswith("classifier_error"):
                    failed += 1

            if not args.quiet:
                if row.get("abstained"):
                    print(f"  {i:>3}/{len(todo)} id={rid:<5} ABSTAIN  {row.get('reason')}")
                else:
                    dec = " ".join(f"{k}={v.get('value')}" for k, v in (row.get("decisions") or {}).items())
                    fired = ",".join(t[len('topic_'):] for t in (row.get("fired") or [])) or "-"
                    print(f"  {i:>3}/{len(todo)} id={rid:<5} {dec:<18} {fired:<22} "
                          f"-> {','.join(core.route(row))}")

    elapsed = time.time() - started
    # Under --silent speak up only when something happened, so the timer's log
    # stays meaningful. Print directly here: the condition IS the gate, and
    # routing this through say() would apply the silent check twice and swallow
    # the summary even when work was done.
    if not args.silent or written or failed:
        print(f"[sweep] wrote {written} verdicts, abstained {abstained}, "
              f"transport failures {failed}, elapsed {elapsed:.1f}s, routed 0")
    return 0


if __name__ == "__main__":
    sys.exit(main())
