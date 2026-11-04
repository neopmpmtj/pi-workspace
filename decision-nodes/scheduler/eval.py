#!/usr/bin/env python3
"""intake evaluator - offline scoring, FALSE NEGATIVES FIRST.

The contract it enforces:

  A missed detection is a failed instruction that silently never happens.
  A spurious detection only costs a wasted route.

So `must_fire` violations are reported first, always, and they alone decide the
exit code. Exit 1 means do not promote this node to enforcing.

The fixtures use must/must-not rather than an exact expected set, because
demanding an exact set punishes correct-but-unlisted detections. Earlier probe
sets did exactly that and produced three false alarm reports.

Usage:
  python3 eval.py                    # score the probe fixtures
  python3 eval.py --baseline         # compare against recorded corpus verdicts
  python3 eval.py --json             # machine-readable
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config  # noqa: E402
import core  # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(BASE, "fixtures.jsonl")
BASELINE = os.path.join(BASE, "exp5-final-results.jsonl")


def load_fixtures(path):
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def _short(name: str) -> str:
    """Display name: drop a 'topic_' prefix if present, otherwise show it whole.

    Assumes no prefix - node #1 happens to use one, node #2 does not.
    """
    return name[len("topic_"):] if name.startswith("topic_") else name


def _resolve(name: str, known: list[str]):
    """Resolve a fixture's short name against the node's real detector names.

    Accepts an exact match, or a unique suffix match, so a fixture may say 'money'
    for a detector called 'topic_money'. Deliberately does NOT hardcode a prefix:
    that would be one node's naming convention leaking into shared code, and it
    crashed the first node that used a different one.
    """
    if name in known:
        return name
    hits = [k for k in known if k.endswith(f"_{name}")]
    return hits[0] if len(hits) == 1 else None


# Derived from config, so this evaluator works for any node's question set.
GATES = [n for n, s in config.QUESTIONS.items() if s.get("role") == "gate"]
FACETS = [n for n, s in config.QUESTIONS.items() if s.get("role") == "facet"]


def preflight(fixtures):
    """Reject fixtures that name a detector this node does not have.

    A silent fallback here would let a typo quietly disable a check, so this is
    fatal rather than tolerant.
    """
    problems = []
    reserved = {"id", "kind", "text", "note", "must_fire", "must_not_fire"}

    # A gate named 'kind' would be shadowed by the fixture format's own 'kind'
    # field, so its expectations would be silently ignored. Fail loudly instead.
    for g in GATES:
        if g in reserved:
            problems.append(f"config: gate name {g!r} collides with a reserved fixture key")

    gatelike = set(GATES) | {"act"}   # 'act' accepted as a legacy alias for the gate
    for f in fixtures:
        for key in ("must_fire", "must_not_fire"):
            for raw in f.get(key, []):
                if _resolve(raw, FACETS) is None:
                    problems.append(f"{f.get('id')}: {key} names unknown detector {raw!r}")
        for g in f:
            if g in reserved:
                continue
            if g not in gatelike:
                problems.append(f"{f.get('id')}: unknown gate field {g!r}")
    return problems


def score_probes(resolved, quiet=False, fixtures_path=None):
    fixtures = load_fixtures(fixtures_path or FIXTURES)
    problems = preflight(fixtures)
    if problems:
        print("fixture problems - fix these before scoring:")
        for p in problems:
            print(f"    {p}")
        return None, None, None, None

    false_negatives, false_positives, act_errors, abstains = [], [], [], []
    per_topic = {t: {"tp": 0, "fp": 0, "fn": 0} for t in FACETS}

    for f in fixtures:
        required = [r for r in (_resolve(x, FACETS) for x in f.get("must_fire", [])) if r]
        forbidden = [r for r in (_resolve(x, FACETS) for x in f.get("must_not_fire", [])) if r]
        row = core.to_verdict(f["text"], context="", resolved=resolved)
        if row.get("abstained"):
            abstains.append((f["id"], row.get("reason")))
            # an abstain cannot fire must_fire -> count it as a miss, loudly
            for t in required:
                false_negatives.append((f["id"], t, "ABSTAINED"))
                per_topic[t]["fn"] += 1
            continue

        fired = set(row.get("fired") or [])
        for t in required:
            if t in fired:
                per_topic[t]["tp"] += 1
            else:
                p = ((row.get("detections") or {}).get(t) or {}).get("probability")
                false_negatives.append((f["id"], t, f"p={p}"))
                per_topic[t]["fn"] += 1
        for t in forbidden:
            if t in fired:
                false_positives.append((f["id"], t))
                per_topic[t]["fp"] += 1

        # gates: compare every gate the fixture names
        for g in GATES:
            want = f.get(g)
            if want is None:
                continue
            got = core.gate_value(row, g)
            if got != want:
                conf = ((row.get("decisions") or {}).get(g) or {}).get("confidence")
                act_errors.append((f["id"], want, got, conf))

    total_required = sum(len(f.get("must_fire", [])) for f in fixtures)
    total_forbidden = sum(len(f.get("must_not_fire", [])) for f in fixtures)

    if not quiet:
        print(f"fixtures: {len(fixtures)} probes")
        print(f"  required detections: {total_required}   forbidden: {total_forbidden}\n")

        print(f"FALSE NEGATIVES: {len(false_negatives)}")
        for i, t, why in false_negatives:
            print(f"    {i:<4} missed {_short(t):<9} ({why})")
        if not false_negatives:
            print("    none - no instruction would be silently dropped")

        print(f"\nfalse positives: {len(false_positives)}  (tolerable, but they cost a route)")
        for i, t in false_positives:
            print(f"    {i:<4} spurious {_short(t)}")

        print(f"\nact mismatches: {len(act_errors)}")
        for i, want, got, conf in act_errors:
            print(f"    {i:<4} want {want:<9} got {str(got):<9} conf={conf}")

        print(f"\nabstains: {len(abstains)}")
        for i, why in abstains:
            print(f"    {i:<4} {why}")

        print("\nper-detector:")
        print(f"    {'detector':<10} {'hit':>5} {'miss':>5} {'spurious':>9}")
        for t in FACETS:
            s = per_topic[t]
            print(f"    {_short(t):<10} {s['tp']:>5} {s['fn']:>5} {s['fp']:>9}")

    return false_negatives, false_positives, act_errors, abstains


def drift(resolved, limit=0):
    """Re-judge the recorded corpus baseline and report any movement."""
    if not os.path.exists(BASELINE):
        print(f"no baseline at {BASELINE}")
        return 0
    base = {}
    with open(BASELINE, encoding="utf-8") as fh:
        for line in fh:
            r = json.loads(line)
            base[r["id"]] = r
    print(f"baseline entries: {len(base)}")
    print("NOTE: re-judging requires the source text, which lives in the legacy")
    print("      database. The baseline file itself is text-free, so this mode")
    print("      reports the recorded distribution only.")
    dist = {}
    for r in base.values():
        dist[r.get("act")] = dist.get(r.get("act"), 0) + 1
    for k, v in sorted(dist.items(), key=lambda kv: -kv[1]):
        print(f"  act={k:<10} {v:>4}")
    fired = sum(1 for r in base.values() if r.get("fired"))
    print(f"  entries with >=1 topic fired: {fired}/{len(base)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="intake evaluator")
    ap.add_argument("--baseline", action="store_true", help="inspect recorded corpus baseline")
    ap.add_argument("--fixtures", default=None, help="score a different fixture set")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    try:
        resolved = core.resolve_model()
    except core.ClassifierError as exc:
        print(f"FATAL: {exc}", file=sys.stderr)
        return 2

    if args.baseline:
        return drift(resolved, args.limit)

    started = time.time()
    fn, fp, act_err, abst = score_probes(resolved, quiet=args.json, fixtures_path=args.fixtures)
    if fn is None:
        return 2

    if args.json:
        print(json.dumps({
            "false_negatives": fn, "false_positives": fp,
            "act_mismatches": act_err, "abstains": abst,
            "elapsed_s": round(time.time() - started, 1),
        }, indent=2))

    print(f"\nelapsed {time.time() - started:.1f}s")
    if fn:
        print(f"\nFAIL - {len(fn)} false negative(s). Observing is fine; enforcing is not.")
        return 1
    print("\nPASS - no false negatives on the probe set.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
