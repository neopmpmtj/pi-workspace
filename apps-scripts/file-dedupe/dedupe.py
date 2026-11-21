#!/usr/bin/env python3
"""file-dedupe — content-based duplicate finder and quarantiner.

Duplicates are decided by content only (size -> head+tail hash -> full SHA-256).
Nothing is ever removed without a written report; the default action is to move
duplicates into <root>/.dedupe/quarantine-<date>/ on the same filesystem, which is
instant and reversible.

Subcommands
    scan     walk the roots, hash the candidates, write the index and the report
    report   rebuild CSV + summary from an existing index
    apply    quarantine / delete / hard-link the duplicates (dry-run by default)
    verify   re-hash a random sample of a quarantine and its keepers
    restore  move a quarantine back to where the files came from
    purge    empty a quarantine once you are satisfied

Stdlib only. See README.md for the exact commands.
"""

from __future__ import annotations

import argparse
import csv
import fnmatch
import hashlib
import json
import os
import random
import shutil
import sqlite3
import stat
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

CHUNK = 64 * 1024           # head/tail hash window
READ_BLOCK = 4 * 1024 * 1024
DEFAULT_MIN_SIZE = 1024 * 1024
FRESH_WINDOW = 10 * 60      # seconds

# Directory names never walked. Content is either regenerable, OS metadata, or
# our own state.
NOISE_DIRS = {
    ".dedupe",
    ".thumbnails",
    ".Trash",
    ".Trash-1000",
    "$RECYCLE.BIN",
    "System Volume Information",
    "lost+found",
    "node_modules",
    ".git",
    "snap",
    ".venv",
    "__pycache__",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS files (
    root      TEXT NOT NULL,
    path      TEXT NOT NULL,
    size      INTEGER NOT NULL,
    mtime_ns  INTEGER NOT NULL,
    depth     INTEGER NOT NULL,
    headtail  TEXT,
    full_hash TEXT,
    last_seen INTEGER,
    PRIMARY KEY (root, path)
);
CREATE INDEX IF NOT EXISTS files_size ON files(root, size);
CREATE INDEX IF NOT EXISTS files_headtail ON files(root, size, headtail);
CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY,
    root        TEXT NOT NULL,
    mode        TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    min_size    INTEGER NOT NULL,
    files       INTEGER,
    groups      INTEGER,
    wasted      INTEGER,
    params      TEXT
);
CREATE TABLE IF NOT EXISTS quarantine (
    run_id         INTEGER,
    root           TEXT,
    original       TEXT,
    quarantined_to TEXT,
    keeper         TEXT,
    sha256         TEXT,
    size           INTEGER,
    at             TEXT
);
"""


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def human(n: float) -> str:
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if abs(n) < 1024 or unit == "TiB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} TiB"


def parse_size(text: str) -> int:
    """'1MB' / '10M' / '512KiB' / '1048576' -> bytes."""
    text = str(text).strip().upper()
    units = {
        "": 1, "B": 1,
        "K": 1024, "KB": 1024, "KIB": 1024,
        "M": 1024 ** 2, "MB": 1024 ** 2, "MIB": 1024 ** 2,
        "G": 1024 ** 3, "GB": 1024 ** 3, "GIB": 1024 ** 3,
        "T": 1024 ** 4, "TB": 1024 ** 4, "TIB": 1024 ** 4,
    }
    num = text
    suffix = ""
    for i, ch in enumerate(text):
        if not (ch.isdigit() or ch == "."):
            num, suffix = text[:i], text[i:]
            break
    if suffix not in units:
        raise argparse.ArgumentTypeError(f"bad size: {text!r}")
    return int(float(num) * units[suffix])


def depth_of(rel: Path) -> int:
    return max(len(rel.parts) - 1, 0)


def open_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(path))
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    return con


def root_mountpoints(root: Path) -> list[str]:
    """Every path that is a mount point between / and root, deepest last."""
    out, cur = [], root
    while True:
        if os.path.ismount(cur):
            out.append(str(cur))
        if cur == cur.parent:
            break
        cur = cur.parent
    return list(reversed(out))


# --------------------------------------------------------------------------- #
# preflight
# --------------------------------------------------------------------------- #
@dataclass
class Preflight:
    root: Path
    dev: int
    free: int
    mountpoint: bool


def preflight(root: Path, allow_any_dir: bool, need_writable: bool) -> Preflight:
    root = root.resolve()
    if str(root) == "/":
        raise SystemExit("[FAIL] refusing to scan '/' — pick a real directory")
    if not root.is_dir():
        raise SystemExit(f"[FAIL] not a directory: {root}")
    mountpoint = os.path.ismount(root)
    if not mountpoint and not allow_any_dir:
        raise SystemExit(
            f"[FAIL] {root} is not a mount point — an unmounted drive would be "
            "scanned as an empty folder.\n"
            "       Mount it, or pass --allow-any-dir for a deliberate sub-folder scan."
        )
    if need_writable and not os.access(root, os.W_OK):
        raise SystemExit(f"[FAIL] {root} is not writable — quarantine needs write access")
    st = root.stat()
    usage = shutil.disk_usage(root)
    return Preflight(root=root, dev=st.st_dev, free=usage.free, mountpoint=mountpoint)


# --------------------------------------------------------------------------- #
# scan
# --------------------------------------------------------------------------- #
@dataclass
class ScanStats:
    seen: int = 0
    kept: int = 0
    skipped: dict = field(default_factory=dict)
    fresh: list = field(default_factory=list)
    errors: list = field(default_factory=list)

    def skip(self, reason: str) -> None:
        self.skipped[reason] = self.skipped.get(reason, 0) + 1


def iter_candidates(root: Path, dev: int, min_size: int, excludes: list[str],
                    stats: ScanStats, fresh_window: int):
    """Yield (rel, size, mtime_ns, depth) for regular single-link files."""
    now_ns = time.time_ns()
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False, onerror=stats.errors.append):
        d = Path(dirpath)
        rel_dir = d.relative_to(root)
        dirnames[:] = sorted(
            name for name in dirnames
            if name not in NOISE_DIRS
            and not any(fnmatch.fnmatch(str(rel_dir / name), pat) for pat in excludes)
        )
        for name in sorted(filenames):
            stats.seen += 1
            p = d / name
            try:
                st = p.lstat()
            except OSError as exc:
                stats.errors.append(exc)
                stats.skip("unreadable")
                continue
            if stat.S_ISLNK(st.st_mode):
                stats.skip("symlink")
                continue
            if not stat.S_ISREG(st.st_mode):
                stats.skip("not-a-regular-file")
                continue
            if st.st_nlink > 1:
                stats.skip("hard-linked")
                continue
            if st.st_dev != dev:
                stats.skip("other-filesystem")
                continue
            if st.st_size == 0:
                stats.skip("zero-byte")
                continue
            if st.st_size < min_size:
                stats.skip("below-min-size")
                continue
            if fresh_window and now_ns - st.st_mtime_ns < fresh_window * 1_000_000_000:
                stats.fresh.append(str(p))
            rel = p.relative_to(root)
            stats.kept += 1
            yield str(rel), st.st_size, st.st_mtime_ns, depth_of(rel)
            if stats.kept % 2000 == 0:
                print(f"  scanned {stats.kept:,} candidates "
                      f"({stats.seen:,} entries)", file=sys.stderr, flush=True)


def headtail_hash(p: Path, size: int) -> str:
    h = hashlib.sha256(f"{size}:".encode())
    with open(p, "rb") as f:
        h.update(f.read(CHUNK))
        if size > CHUNK:
            f.seek(max(size - CHUNK, CHUNK))
            h.update(f.read())
    return h.hexdigest()


def full_hash(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while block := f.read(READ_BLOCK):
            h.update(block)
    return h.hexdigest()


def _hash_job(kind: str, root: Path, rel: str, size: int):
    p = root / rel
    try:
        return rel, (headtail_hash(p, size) if kind == "headtail" else full_hash(p)), None
    except OSError as exc:
        return rel, None, f"{p}: {exc}"


def run_hashes(con, kind: str, rows: list[sqlite3.Row], root: Path, jobs: int,
               errors: list) -> None:
    column = "headtail" if kind == "headtail" else "full_hash"
    todo = [(r["path"], r["size"]) for r in rows if not r[column]]
    if not todo:
        return
    update = f"UPDATE files SET {column}=? WHERE root=? AND path=?"
    done = 0
    with ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
        for start in range(0, len(todo), 2000):
            batch = todo[start:start + 2000]
            buffer = []
            for fut in [pool.submit(_hash_job, kind, root, rel, size)
                        for rel, size in batch]:
                rel, value, err = fut.result()
                done += 1
                if err:
                    errors.append(err)
                    continue
                buffer.append((value, root.as_posix(), rel))
            if buffer:
                con.executemany(update, buffer)
                con.commit()
            print(f"  {kind}: {done:,}/{len(todo):,}", file=sys.stderr, flush=True)


@dataclass
class ScanResult:
    run_id: int
    stats: ScanStats
    fresh_abort: bool


def cmd_scan(args) -> int:
    roots = [Path(r).expanduser().resolve() for r in args.root]
    min_size = parse_size(args.min_size)
    # preflight every root before a single byte is written anywhere
    preflights = {root: preflight(root, args.allow_any_dir, need_writable=False)
                  for root in roots}
    db_path = Path(args.db).expanduser() if args.db else \
        roots[0] / ".dedupe" / "index.sqlite"
    con = open_db(db_path)

    started = now()
    cur = con.execute(
        "INSERT INTO runs(root, mode, started_at, min_size, params) VALUES(?,?,?,?,?)",
        (",".join(str(r) for r in roots), "scan", started, min_size,
         json.dumps({"keep": args.keep, "excludes": args.exclude})))
    run_id = cur.lastrowid
    con.commit()

    fresh_total: list[str] = []
    errors: list[str] = []
    stats = ScanStats()

    for root in roots:
        pf = preflights[root]
        print(f"[scan] {root}  mountpoint={pf.mountpoint}  free={human(pf.free)}")
        print(f"[scan] min-size={human(min_size)} jobs={args.jobs} db={db_path}")
        insert = (
            "INSERT INTO files(root, path, size, mtime_ns, depth, last_seen) "
            "VALUES(?,?,?,?,?,?) ON CONFLICT(root, path) DO UPDATE SET "
            "headtail = CASE WHEN files.size=excluded.size "
            "  AND files.mtime_ns=excluded.mtime_ns THEN files.headtail END, "
            "full_hash = CASE WHEN files.size=excluded.size "
            "  AND files.mtime_ns=excluded.mtime_ns THEN files.full_hash END, "
            "size=excluded.size, mtime_ns=excluded.mtime_ns, "
            "depth=excluded.depth, last_seen=excluded.last_seen"
        )
        batch = []
        for rel, size, mtime_ns, depth in iter_candidates(
                root, pf.dev, min_size, args.exclude, stats,
                args.fresh_window):
            batch.append((str(root), rel, size, mtime_ns, depth, run_id))
            if len(batch) >= 1000:
                con.executemany(insert, batch)
                con.commit()
                batch.clear()
        if batch:
            con.executemany(insert, batch)
            con.commit()
        con.execute("DELETE FROM files WHERE root=? AND last_seen<>?",
                    (str(root), run_id))
        con.commit()
        fresh_total.extend(stats.fresh)
        stats.fresh = []

    if fresh_total and not args.ignore_fresh:
        print(f"\n[FAIL] {len(fresh_total)} file(s) changed within "
              f"{args.fresh_window // 60} min — something is still being written:",
              file=sys.stderr)
        for p in fresh_total[:5]:
            print(f"       {p}", file=sys.stderr)
        print("       Re-run later, or pass --ignore-fresh to scan anyway.",
              file=sys.stderr)
        con.execute("UPDATE runs SET finished_at=? WHERE id=?", (now(), run_id))
        con.commit()
        return 2

    print(f"[scan] {stats.kept:,} candidates from {stats.seen:,} entries; "
          f"skipped: {dict(sorted(stats.skipped.items()))}")

    # stage B: head+tail for size buckets that actually collide
    roots_sql = ",".join("?" * len(roots))
    sizes = con.execute(
        f"SELECT size FROM files WHERE root IN ({roots_sql}) AND size>=? "
        "GROUP BY size HAVING COUNT(*)>1 ORDER BY size DESC",
        [str(r) for r in roots] + [min_size]).fetchall()
    print(f"[scan] {len(sizes):,} size bucket(s) with 2+ members")
    for root in roots:
        # stage B: head+tail for size buckets that actually collide
        for bucket in con.execute(
                "SELECT size FROM files WHERE root=? AND size>=? "
                "GROUP BY size HAVING COUNT(*)>1", (str(root), min_size)).fetchall():
            rows = con.execute(
                "SELECT path, size, headtail FROM files WHERE root=? AND size=?",
                (str(root), bucket["size"])).fetchall()
            if len(rows) > 1:
                run_hashes(con, "headtail", rows, root, args.jobs, errors)
        # stage C: full SHA-256 only where head+tail still collides
        for bucket in con.execute(
                "SELECT size, headtail FROM files WHERE root=? AND headtail IS NOT NULL "
                "AND size>=? GROUP BY size, headtail HAVING COUNT(*)>1",
                (str(root), min_size)).fetchall():
            rows = con.execute(
                "SELECT path, size, full_hash FROM files WHERE root=? AND size=? "
                "AND headtail=?",
                (str(root), bucket["size"], bucket["headtail"])).fetchall()
            if len(rows) > 1:
                run_hashes(con, "full_hash", rows, root, args.jobs, errors)

    if errors:
        print(f"[scan] {len(errors)} read error(s), first: {errors[0]}", file=sys.stderr)

    groups = compute_groups(con, roots, min_size, args.keep)
    wasted = sum(g["wasted"] for g in groups)
    con.execute("UPDATE runs SET finished_at=?, files=?, groups=?, wasted=? WHERE id=?",
                (now(), stats.kept, len(groups), wasted, run_id))
    con.commit()

    out = Path(args.out) if args.out else db_path.parent / "reports" / str(run_id)
    write_report(con, groups, out, db_path, roots, stats, args.top, run_id)
    print_summary(groups, out, wasted)
    con.close()
    return 0


# --------------------------------------------------------------------------- #
# grouping + keeper
# --------------------------------------------------------------------------- #
def keeper_key(member: dict, keep: list[str]):
    m = member["rel"]
    matched = any(fnmatch.fnmatch(m, pat) or fnmatch.fnmatch(member["name"], pat)
                  for pat in keep) if keep else False
    return (0 if matched else 1, member["depth"], member["mtime_ns"],
            len(member["name"]), m), matched


def compute_groups(con, roots: list[Path], min_size: int, keep: list[str]) -> list[dict]:
    groups = []
    for root in roots:
        rows = con.execute(
            "SELECT path, size, mtime_ns, depth, full_hash FROM files "
            "WHERE root=? AND size>=? AND full_hash IS NOT NULL "
            "ORDER BY size DESC, path", (str(root), min_size)).fetchall()
        buckets: dict[tuple, list] = {}
        for r in rows:
            buckets.setdefault((r["size"], r["full_hash"]), []).append(r)
        for (size, digest), members in buckets.items():
            if len(members) < 2:
                continue
            entries = [{
                "root": str(root),
                "rel": m["path"],
                "abs": str(root / m["path"]),
                "name": Path(m["path"]).name,
                "size": m["size"],
                "mtime_ns": m["mtime_ns"],
                "depth": m["depth"],
            } for m in members]
            entries.sort(key=lambda e: keeper_key(e, keep)[0])
            keeper = entries[0]
            why = "keep-glob" if keeper_key(keeper, keep)[1] else (
                "shallowest" if len({e["depth"] for e in entries}) > 1 else
                "oldest-mtime" if len({e["mtime_ns"] for e in entries}) > 1 else
                "shortest-name")
            groups.append({
                "root": str(root),
                "sha256": digest,
                "size": size,
                "keeper": keeper,
                "keeper_reason": why,
                "duplicates": entries[1:],
                "wasted": size * (len(entries) - 1),
            })
    groups.sort(key=lambda g: (-g["wasted"], g["keeper"]["abs"]))
    return groups


# --------------------------------------------------------------------------- #
# report
# --------------------------------------------------------------------------- #
def write_report(con, groups, out: Path, db_path: Path, roots, stats, top: int,
                 run_id: int) -> None:
    out.mkdir(parents=True, exist_ok=True)
    csv_path = out / "duplicates.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["group", "sha256", "size_bytes", "keeper", "keeper_reason",
                    "duplicate", "duplicate_mtime", "duplicate_depth", "wasted_bytes"])
        for gi, g in enumerate(groups, 1):
            for d in g["duplicates"]:
                w.writerow([gi, g["sha256"], g["size"], g["keeper"]["abs"],
                            g["keeper_reason"], d["abs"],
                            datetime.fromtimestamp(d["mtime_ns"] / 1e9).isoformat(timespec="seconds"),
                            d["depth"], g["size"]])

    wasted = sum(g["wasted"] for g in groups)
    total_dupes = sum(len(g["duplicates"]) for g in groups)
    by_folder: dict[str, int] = {}
    for g in groups:
        for d in g["duplicates"]:
            parts = Path(d["rel"]).parts
            key = parts[0] if len(parts) > 1 else "(root)"
            by_folder[key] = by_folder.get(key, 0) + g["size"]

    md = out / "summary.md"
    with md.open("w", encoding="utf-8") as fh:
        fh.write("# file-dedupe report\n\n")
        fh.write(f"- run: {run_id} · {now()}\n")
        fh.write(f"- roots: {', '.join(str(r) for r in roots)}\n")
        fh.write(f"- index: {db_path}\n")
        fh.write(f"- candidates hashed: {stats.kept:,} of {stats.seen:,} entries\n")
        fh.write(f"- skipped: {dict(sorted(stats.skipped.items()))}\n")
        fh.write(f"- groups: {len(groups):,} · duplicates: {total_dupes:,} "
                 f"· reclaimable: {human(wasted)} ({wasted:,} bytes)\n")
        fh.write(f"- nothing was moved or deleted (this is a report)\n\n")
        if by_folder:
            fh.write("## Reclaimable by top-level folder\n\n| Folder | Reclaimable |\n| --- | --- |\n")
            for k, v in sorted(by_folder.items(), key=lambda kv: -kv[1]):
                fh.write(f"| `{k}` | {human(v)} |\n")
            fh.write("\n")
        fh.write(f"## Largest {min(top, len(groups))} groups\n\n")
        for gi, g in enumerate(groups[:top], 1):
            fh.write(f"### {gi}. {human(g['size'])} × {len(g['duplicates']) + 1} "
                     f"— reclaimable {human(g['wasted'])}\n\n")
            fh.write(f"- keeper ({g['keeper_reason']}): `{g['keeper']['abs']}`\n")
            for d in g["duplicates"]:
                fh.write(f"- duplicate: `{d['abs']}`\n")
            fh.write(f"- sha256: `{g['sha256']}`\n\n")
        if len(groups) > top:
            fh.write(f"…and {len(groups) - top:,} more groups in `{csv_path.name}`.\n")
    print(f"[report] {md}")
    print(f"[report] {csv_path}")


def print_summary(groups, out: Path, wasted: int) -> None:
    print()
    print(f"  groups            {len(groups):,}")
    print(f"  duplicates        {sum(len(g['duplicates']) for g in groups):,}")
    print(f"  reclaimable       {human(wasted)}")
    print(f"  largest group     "
          f"{human(groups[0]['size']) if groups else '—'}")
    print(f"  report            {out}/summary.md")
    print()


def cmd_report(args) -> int:
    db_path = Path(args.db).expanduser()
    if not db_path.is_file():
        raise SystemExit(f"[FAIL] no index at {db_path}")
    con = open_db(db_path)
    roots = [Path(r).resolve() for r in args.root] if args.root else [
        Path(r["root"]) for r in con.execute("SELECT DISTINCT root FROM files")]
    min_size = parse_size(args.min_size)
    groups = compute_groups(con, roots, min_size, args.keep)
    out = Path(args.out) if args.out else db_path.parent / "reports" / "latest"
    last = con.execute("SELECT id FROM runs ORDER BY id DESC LIMIT 1").fetchone()
    stats = ScanStats(kept=con.execute(
        "SELECT COUNT(*) FROM files").fetchone()[0])
    write_report(con, groups, out, db_path, roots, stats, args.top,
                 last["id"] if last else 0)
    print_summary(groups, out, sum(g["wasted"] for g in groups))
    con.close()
    return 0


# --------------------------------------------------------------------------- #
# apply
# --------------------------------------------------------------------------- #
def unique_path(p: Path) -> Path:
    if not p.exists():
        return p
    stem, suffix, n = p.stem, p.suffix, 1
    while True:
        cand = p.with_name(f"{stem}~{n}{suffix}")
        if not cand.exists():
            return cand
        n += 1


def cmd_apply(args) -> int:
    db_path = Path(args.db).expanduser()
    if not db_path.is_file():
        raise SystemExit(f"[FAIL] no index at {db_path}")
    con = open_db(db_path)
    roots = [Path(r).resolve() for r in args.root] if args.root else [
        Path(r["root"]) for r in con.execute("SELECT DISTINCT root FROM files")]
    min_size = parse_size(args.min_size)
    groups = compute_groups(con, roots, min_size, args.keep)
    if args.limit:
        groups = groups[: args.limit]
    planned = sum(len(g["duplicates"]) for g in groups)
    wasted = sum(g["wasted"] for g in groups)

    print(f"[apply] {'DRY-RUN' if not args.apply else 'APPLY'} · "
          f"{len(groups):,} groups · {planned:,} files · {human(wasted)}")
    if not planned:
        con.close()
        return 0

    out = Path(args.out) if args.out else db_path.parent / "reports" / f"apply-{int(time.time())}"
    write_report(con, groups, out, db_path, roots, ScanStats(), args.top, 0)

    if not args.apply:
        for g in groups[:10]:
            print(f"  would keep    {g['keeper']['abs']}")
            for d in g["duplicates"][:3]:
                print(f"  would move    {d['abs']}")
        print(f"\n  plan written to {out}/duplicates.csv")
        print("  nothing changed. Re-run with --apply to quarantine.")
        con.close()
        return 0

    if args.delete and not args.yes_i_have_a_backup:
        raise SystemExit("[FAIL] --delete needs --yes-i-have-a-backup")

    date = args.date or datetime.now().strftime("%Y-%m-%d")
    stamped = args.date is not None
    run_id = con.execute(
        "INSERT INTO runs(root, mode, started_at, min_size, params) VALUES(?,?,?,?,?)",
        (",".join(str(r) for r in roots), "apply", now(), min_size,
         json.dumps({"action": args.action}))).lastrowid
    con.commit()

    moved: list[tuple[str, str, str, int]] = []
    qdirs: dict[str, Path] = {}
    errors: list[str] = []
    manifest_fhs = {}

    def manifest(root: str):
        if root not in manifest_fhs:
            q = qdirs[root]
            manifest_fhs[root] = (q / "manifest.jsonl").open("a", encoding="utf-8")
        return manifest_fhs[root]

    for g in groups:
        keeper = g["keeper"]["abs"]
        root = g["root"]
        if not Path(keeper).exists():
            errors.append(f"keeper vanished since the scan, skipping group: {keeper}")
            continue
        if root not in qdirs:
            qdirs[root] = Path(root) / ".dedupe" / (
                f"quarantine-{date}" if args.action != "delete" else "deleted")
        for d in g["duplicates"]:
            src = Path(d["abs"])
            try:
                if args.action == "delete":
                    src.unlink()
                    record = ("delete", str(src), "", g["sha256"])
                elif args.action == "link":
                    tmp = src.with_name(src.name + ".dedupe-link")
                    os.unlink(tmp) if tmp.exists() else None
                    os.link(keeper, tmp)
                    os.replace(tmp, src)
                    record = ("link", str(src), keeper, g["sha256"])
                else:
                    q = qdirs[root]
                    dst = unique_path(q / Path(d["rel"]))
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(src), str(dst))
                    sized = dst.stat().st_size
                    record = ("quarantine", str(src), str(dst), g["sha256"])
                    manifest(root).write(json.dumps({
                        "original": str(src), "quarantined_to": str(dst),
                        "keeper": keeper, "sha256": g["sha256"], "size": sized,
                        "run_id": run_id, "at": now()}) + "\n")
                    manifest(root).flush()
                    moved.append((str(src), str(dst), g["sha256"], sized))
            except OSError as exc:
                errors.append(f"{src}: {exc}")
                continue
            con.execute(
                "INSERT INTO quarantine(run_id, root, original, quarantined_to, "
                "keeper, sha256, size, at) VALUES(?,?,?,?,?,?,?,?)",
                (run_id, root, record[1], record[2], keeper, record[3],
                 g["size"], now()))
            if args.action == "quarantine":
                print(f"  moved  {src}  ->  {record[2]}")

    for fh in manifest_fhs.values():
        fh.close()
    con.commit()

    if args.action == "quarantine" and moved:
        bad = sample_verify(moved, args.sample, con)
        if bad:
            print(f"[FAIL] verification failed for {len(bad)} file(s): {bad[0]}",
                  file=sys.stderr)
            print("       restoring the whole batch", file=sys.stderr)
            restore_pairs([(s, d) for s, d, _, _ in moved])
            con.close()
            return 3
        print(f"[apply] verified a {args.sample:.0%} sample of {len(moved)} moved files")

    if errors:
        print(f"[apply] {len(errors)} error(s), first: {errors[0]}", file=sys.stderr)
    con.execute("UPDATE runs SET finished_at=?, groups=?, wasted=? WHERE id=?",
                (now(), len(groups), wasted, run_id))
    con.commit()
    print(f"[apply] done · {len(moved)} quarantined · {human(sum(m[3] for m in moved))}"
          if args.action == "quarantine" else f"[apply] done · action={args.action}")
    if args.action == "quarantine":
        print(f"[apply] manifest(s): "
              f"{', '.join(str(q / 'manifest.jsonl') for q in qdirs.values())}")
    con.close()
    return 0 if not errors else 4


def sample_verify(moved, fraction: float, con) -> list[str]:
    if not moved:
        return []
    n = max(1, int(len(moved) * fraction))
    sample = random.sample(moved, min(n, len(moved)))
    bad = []
    for original, quarantined, digest, size in sample:
        try:
            if Path(quarantined).stat().st_size != size or full_hash(Path(quarantined)) != digest:
                bad.append(quarantined)
        except OSError as exc:
            bad.append(f"{quarantined}: {exc}")
    return bad


def restore_pairs(pairs) -> None:
    for original, quarantined in pairs:
        src, dst = Path(original), Path(quarantined)
        try:
            if dst.exists() and not src.exists():
                src.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(dst), str(src))
                print(f"  restored {src}")
        except OSError as exc:
            print(f"[FAIL] could not restore {src}: {exc}", file=sys.stderr)


# --------------------------------------------------------------------------- #
# verify / restore / purge
# --------------------------------------------------------------------------- #
def read_manifest(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def cmd_verify(args) -> int:
    manifest = Path(args.manifest).expanduser()
    rows = read_manifest(manifest)
    if not rows:
        raise SystemExit(f"[FAIL] empty manifest: {manifest}")
    n = max(1, int(len(rows) * args.sample))
    sample = random.sample(rows, min(n, len(rows)))
    bad = []
    for row in sample:
        keeper, dup = Path(row["keeper"]), Path(row["quarantined_to"])
        try:
            if not keeper.exists():
                bad.append(f"keeper missing: {keeper}")
                continue
            if full_hash(keeper) != row["sha256"]:
                bad.append(f"keeper content changed: {keeper}")
            if dup.exists() and full_hash(dup) != row["sha256"]:
                bad.append(f"quarantined content changed: {dup}")
        except OSError as exc:
            bad.append(str(exc))
    print(f"[verify] {len(sample)}/{len(rows)} sampled · "
          f"{'OK' if not bad else f'{len(bad)} problem(s)'}")
    if bad:
        for b in bad[:10]:
            print(f"  [FAIL] {b}", file=sys.stderr)
        if args.restore_on_failure:
            restore_pairs([(r["original"], r["quarantined_to"]) for r in rows])
        return 1
    return 0


def cmd_restore(args) -> int:
    manifest = Path(args.manifest).expanduser()
    rows = read_manifest(manifest)
    if not rows:
        raise SystemExit(f"[FAIL] empty manifest: {manifest}")
    conflict = [r for r in rows if Path(r["original"]).exists()]
    if conflict and not args.overwrite:
        raise SystemExit(
            f"[FAIL] {len(conflict)} original path(s) already exist, first: "
            f"{conflict[0]['original']}\n"
            "       Move them away, or pass --overwrite to replace them.")
    restore_pairs([(r["original"], r["quarantined_to"]) for r in rows])
    print(f"[restore] {len(rows)} file(s) put back")
    return 0


def cmd_purge(args) -> int:
    root = Path(args.root).expanduser().resolve()
    base = root / ".dedupe"
    if args.date:
        targets = [base / f"quarantine-{args.date}"]
    else:
        targets = [p for p in base.iterdir() if p.name.startswith("quarantine-")]
    targets = [t for t in targets if t.exists()]
    if not targets:
        raise SystemExit(f"[FAIL] no quarantine folder at {base}")
    total = sum(f.stat().st_size for t in targets
                for f in t.rglob("*") if f.is_file())
    if not args.yes:
        print(f"[purge] would delete {len(targets)} quarantine folder(s), "
              f"{human(total)}: {', '.join(str(t) for t in targets)}")
        print("        re-run with --yes")
        return 0
    for t in targets:
        shutil.rmtree(t)
    print(f"[purge] removed {len(targets)} folder(s), {human(total)} freed")
    return 0


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="dedupe.py", description="find and quarantine duplicate files by content")
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp):
        sp.add_argument("--db", help="SQLite index (default <root>/.dedupe/index.sqlite)")
        sp.add_argument("--root", action="append", help="root to scan/report on")
        sp.add_argument("--min-size", default="1MB", help="size floor (default 1MB)")
        sp.add_argument("--keep", action="append", default=[],
                        help="glob of paths that must win (repeatable)")
        sp.add_argument("--top", type=int, default=25, help="groups in summary.md")

    s = sub.add_parser("scan", help="walk + hash + write the report")
    common(s)
    s.add_argument("--jobs", type=int, default=min(8, os.cpu_count() or 4))
    s.add_argument("--exclude", action="append", default=[],
                   help="relative-dir glob to skip (repeatable)")
    s.add_argument("--fresh-window", type=int, default=FRESH_WINDOW,
                   help="seconds; abort if content is newer (default 600)")
    s.add_argument("--ignore-fresh", action="store_true")
    s.add_argument("--allow-any-dir", action="store_true",
                   help="allow a non-mount-point root")
    s.add_argument("--out", help="report directory")
    s.set_defaults(func=cmd_scan)

    r = sub.add_parser("report", help="rebuild CSV + summary from an index")
    common(r)
    r.add_argument("--out", help="report directory")
    r.set_defaults(func=cmd_report)

    a = sub.add_parser("apply", help="quarantine/delete/link duplicates (dry-run default)")
    common(a)
    a.add_argument("--apply", action="store_true", help="actually act")
    a.add_argument("--action", choices=["quarantine", "delete", "link"],
                   default="quarantine")
    a.add_argument("--delete", action="store_true", help="shortcut for --action delete")
    a.add_argument("--link", action="store_true", help="shortcut for --action link")
    a.add_argument("--yes-i-have-a-backup", action="store_true")
    a.add_argument("--date", help="quarantine folder name (default today)")
    a.add_argument("--limit", type=int, help="act only on the N worst groups")
    a.add_argument("--sample", type=float, default=0.05)
    a.add_argument("--out", help="report directory")
    a.set_defaults(func=cmd_apply)

    v = sub.add_parser("verify", help="re-hash a sample of a quarantine")
    v.add_argument("--manifest", required=True)
    v.add_argument("--sample", type=float, default=0.05)
    v.add_argument("--restore-on-failure", action="store_true")
    v.set_defaults(func=cmd_verify)

    t = sub.add_parser("restore", help="move a quarantine back")
    t.add_argument("--manifest", required=True)
    t.add_argument("--overwrite", action="store_true")
    t.set_defaults(func=cmd_restore)

    u = sub.add_parser("purge", help="empty a quarantine")
    u.add_argument("--root", required=True)
    u.add_argument("--date", help="quarantine-<date> to remove (default: all)")
    u.add_argument("--yes", action="store_true")
    u.set_defaults(func=cmd_purge)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if getattr(args, "delete", False):
        args.action = "delete"
    if getattr(args, "link", False):
        args.action = "link"
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
