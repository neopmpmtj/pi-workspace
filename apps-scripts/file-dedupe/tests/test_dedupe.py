#!/usr/bin/env python3
"""Tests for dedupe.py — plain unittest, no third-party packages.

    cd ~/.pi/apps-scripts/file-dedupe && python3 -m unittest discover -s test -v
"""

import io
import os
import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import dedupe  # noqa: E402

MiB = 1024 * 1024


def blob(size: int, marker: bytes) -> bytes:
    """size bytes of a repeating marker, identical within a group."""
    return (marker * (size // len(marker) + 1))[:size]


def write(path: Path, data: bytes, mtime: float | None = None) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def run(argv: list[str]) -> tuple[int, str]:
    out, err = io.StringIO(), io.StringIO()
    try:
        with redirect_stdout(out), redirect_stderr(err):
            rc = dedupe.main(argv)
    except SystemExit as exc:  # argparse errors and explicit refusals
        code = exc.code
        msg = "" if code is None or isinstance(code, int) else str(code)
        return (code if isinstance(code, int) else 1), out.getvalue() + msg + err.getvalue()
    return rc, out.getvalue() + err.getvalue()


class Fixture(unittest.TestCase):
    """A tree with every shape the brief lists."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "root"
        self.root.mkdir()
        self.db = self.root / ".dedupe" / "index.sqlite"
        r = self.root

        # 1) exact duplicates, different depths -> shallowest wins
        write(r / "root.bin", blob(1250 * 1024, b"exactdup"), mtime=1_600_000_000)
        write(r / "deep/a/b/copy.bin", blob(1250 * 1024, b"exactdup"),
              mtime=1_500_000_000)

        # 2) case variants of the same content
        write(r / "f/readme.bin", blob(1500 * 1024, b"case"), mtime=1_300_000_000)
        write(r / "f/Readme.BIN", blob(1500 * 1024, b"case"), mtime=1_400_000_000)

        # 3) nested identical names -> oldest mtime wins at equal depth
        write(r / "h/x/data.bin", blob(1750 * 1024, b"nested"), mtime=1_200_000_000)
        write(r / "h/y/data.bin", blob(1750 * 1024, b"nested"), mtime=1_100_000_000)

        # 4) near duplicates: one byte differs mid-file, so head+tail matches
        same = bytearray(blob(2 * MiB, b"near"))
        other = bytearray(same)
        other[MiB + 5] ^= 0xFF
        write(r / "n/one.bin", bytes(same), mtime=1_600_000_000)
        write(r / "n/two.bin", bytes(other), mtime=1_600_000_000)

        # 5) hard links: same inode, must be ignored entirely
        hl = write(r / "hl/first.bin", blob(2250 * 1024, b"hardlink"))
        os.link(hl, r / "hl/second.bin")

        # 6) symlink to a real candidate: must not be followed
        os.symlink(r / "root.bin", r / "sym.bin")

        # 6b) future mtime (camera clock / restored archive): odd data, not a
        # live write — must not trip the freshness guard
        write(r / "future/camera.jpg", blob(1300 * 1024, b"future"), mtime=3_978_000_000)

        # 7) zero byte and below the size floor
        write(r / "e/empty.bin", b"")
        write(r / "e/small.bin", b"x" * 100)

        # 8) noise folders that would otherwise be duplicate pairs
        write(r / ".git/objects/aa/obj.bin", blob(1600 * 1024, b"noise"))
        write(r / "node_modules/pkg/blob.bin", blob(1600 * 1024, b"noise"))

        self.common = ["--db", str(self.db), "--min-size", "1MB"]
        self.scan_flags = ["--allow-any-dir", "--fresh-window", "0", "--jobs", "4"]

    def tearDown(self):
        self.tmp.cleanup()

    # helpers -------------------------------------------------------------
    def scan(self, *extra, ignore_fresh=True):
        argv = ["scan", "--root", str(self.root), *self.common,
                *self.scan_flags, *extra]
        if ignore_fresh:
            argv.append("--ignore-fresh")
        rc, out = run(argv)
        self.assertEqual(rc, 0, out)
        return out

    def con(self):
        return sqlite3.connect(str(self.db))

    def groups(self, *keep):
        con = dedupe.open_db(self.db)
        try:
            return dedupe.compute_groups(con, [self.root.resolve()],
                                         MiB, list(keep))
        finally:
            con.close()

    # tests ---------------------------------------------------------------
    def test_scan_groups_exact_and_case_variants_only(self):
        self.scan()
        sizes = sorted(round(g["size"] / 1024) for g in self.groups())
        self.assertEqual(len(self.groups()), 3, sizes)
        # 1250 KiB (exact), 1500 KiB (case), 1750 KiB (nested) — never the
        # 2048 KiB near-duplicate, never the hard links.
        self.assertEqual(sizes, [1250, 1500, 1750])

    def test_noise_symlink_hardlink_zero_and_small_are_indexed_out(self):
        self.scan()
        paths = {row[0] for row in self.con().execute("SELECT path FROM files")}
        self.assertNotIn("sym.bin", paths)
        self.assertNotIn("hl/first.bin", paths)
        self.assertNotIn("hl/second.bin", paths)
        self.assertNotIn("e/empty.bin", paths)
        self.assertNotIn("e/small.bin", paths)
        self.assertNotIn(".git/objects/aa/obj.bin", paths)
        self.assertNotIn("node_modules/pkg/blob.bin", paths)
        self.assertIn("root.bin", paths)

    def test_keeper_is_shallowest_then_oldest_then_shortest(self):
        self.scan()
        g = {round(x["size"] / 1024): x for x in self.groups()}
        self.assertEqual(Path(g[1250]["keeper"]["abs"]).name, "root.bin")
        self.assertEqual(g[1250]["keeper_reason"], "shallowest")
        self.assertEqual(Path(g[1750]["keeper"]["abs"]).as_posix().split("/")[-2],
                         "y")
        self.assertEqual(g[1750]["keeper_reason"], "oldest-mtime")
        self.assertEqual(Path(g[1500]["keeper"]["abs"]).name, "readme.bin")

    def test_keep_glob_overrides_depth(self):
        self.scan("--keep", "deep/*")
        g = {round(x["size"] / 1024): x for x in self.groups("deep/*")}
        self.assertEqual(Path(g[1250]["keeper"]["abs"]).as_posix().split("/")[-1],
                         "copy.bin")
        self.assertEqual(g[1250]["keeper_reason"], "keep-glob")

    def test_report_files_are_written(self):
        out = self.scan()
        reports = self.root / ".dedupe" / "reports"
        csvs = list(reports.glob("*/duplicates.csv"))
        self.assertEqual(len(csvs), 1, out)
        lines = csvs[0].read_text().strip().splitlines()
        self.assertEqual(len(lines), 4)          # header + 3 duplicates
        self.assertTrue(list(reports.glob("*/summary.md")))
        self.assertIn("groups", out)

    def test_fresh_file_aborts_scan(self):
        # one file written "now" must stop the run before anything is hashed
        write(self.root / "incoming/copy-in-progress.bin", blob(1300 * 1024, b"fresh"))
        rc, out = run(["scan", "--root", str(self.root), "--db", str(self.db),
                       "--min-size", "1MB", "--allow-any-dir", "--jobs", "2"])
        self.assertEqual(rc, 2, out)
        self.assertIn("still being written", out)
        # --ignore-fresh overrides it
        rc, out = run(["scan", "--root", str(self.root), "--db", str(self.db),
                       "--min-size", "1MB", "--allow-any-dir", "--jobs", "2",
                       "--ignore-fresh"])
        self.assertEqual(rc, 0, out)

    def test_future_mtime_does_not_abort_scan(self):
        rc, out = run(["scan", "--root", str(self.root), "--db", str(self.db),
                       "--min-size", "1MB", "--allow-any-dir", "--jobs", "2"])
        self.assertEqual(rc, 0, out)
        self.assertIn("future mtime", out)

    def test_apply_is_dry_by_default(self):
        self.scan()
        rc, out = run(["apply", *self.common])
        self.assertEqual(rc, 0, out)
        self.assertIn("nothing changed", out)
        self.assertEqual(len(list((self.root / "deep/a/b").glob("copy.bin"))), 1)
        self.assertFalse((self.root / ".dedupe" / "quarantine-2020-01-01").exists())

    def test_apply_quarantines_keeps_keeper_and_restores(self):
        self.scan()
        rc, out = run(["apply", *self.common, "--apply", "--date", "2020-01-01"])
        self.assertEqual(rc, 0, out)
        q = self.root / ".dedupe" / "quarantine-2020-01-01"
        self.assertTrue((q / "manifest.jsonl").is_file())

        # keeper still in place, duplicates gone from their old homes
        self.assertTrue((self.root / "root.bin").is_file())
        self.assertFalse((self.root / "deep/a/b/copy.bin").exists())
        self.assertFalse((self.root / "f/Readme.BIN").exists())

        moved = [p for p in q.rglob("*") if p.is_file() and p.name != "manifest.jsonl"]
        self.assertEqual(len(moved), 3)

        con = self.con()
        self.assertEqual(con.execute("SELECT COUNT(*) FROM quarantine").fetchone()[0], 3)

        # restore puts every file back
        rc, out = run(["restore", "--manifest", str(q / "manifest.jsonl")])
        self.assertEqual(rc, 0, out)
        self.assertTrue((self.root / "deep/a/b/copy.bin").is_file())
        self.assertTrue((self.root / "f/Readme.BIN").is_file())
        self.assertTrue((self.root / "h/y/data.bin").is_file())

    def test_verify_accepts_intact_quarantine(self):
        self.scan()
        run(["apply", *self.common, "--apply", "--date", "2020-01-02"])
        rc, out = run(["verify", "--manifest",
                       str(self.root / ".dedupe" / "quarantine-2020-01-02"
                           / "manifest.jsonl"), "--sample", "1.0"])
        self.assertEqual(rc, 0, out)
        self.assertIn("OK", out)

    def test_delete_needs_the_confirmation_flag(self):
        self.scan()
        rc, out = run(["apply", *self.common, "--apply", "--delete"])
        self.assertEqual(rc, 1, out)
        self.assertIn("--yes-i-have-a-backup", out)

    def test_purge_needs_yes_and_then_removes(self):
        self.scan()
        run(["apply", *self.common, "--apply", "--date", "2020-01-03"])
        q = self.root / ".dedupe" / "quarantine-2020-01-03"
        rc, out = run(["purge", "--root", str(self.root), "--date", "2020-01-03"])
        self.assertEqual(rc, 0, out)
        self.assertTrue(q.exists())
        rc, out = run(["purge", "--root", str(self.root), "--date", "2020-01-03",
                       "--yes"])
        self.assertFalse(q.exists())

    def test_refuses_slash(self):
        rc, out = run(["scan", "--root", "/", "--db", str(self.db)])
        self.assertEqual(rc, 1, out)
        self.assertIn("refusing", out)

    def test_refuses_non_mount_without_flag(self):
        rc, out = run(["scan", "--root", str(self.root), "--db", str(self.db)])
        self.assertEqual(rc, 1, out)
        self.assertIn("not a mount point", out)

    @unittest.skipIf(os.geteuid() == 0, "root can read anything")
    def test_unreadable_file_is_reported_not_fatal(self):
        # same size as an existing pair, so the hash stage must try to read it
        locked = write(self.root / "g/locked.bin", blob(1250 * 1024, b"exactdup"))
        locked.chmod(0o000)
        try:
            out = self.scan()
            self.assertIn("read error", out)
            self.assertTrue((self.root / "root.bin").is_file())
        finally:
            locked.chmod(0o600)

    def test_rescan_keeps_hashes_and_drops_vanished_files(self):
        self.scan()
        before = self.con().execute(
            "SELECT COUNT(*) FROM files WHERE full_hash IS NOT NULL").fetchone()[0]
        self.assertGreater(before, 0)
        (self.root / "e/small.bin").unlink()
        self.scan()
        after = self.con().execute(
            "SELECT COUNT(*) FROM files WHERE full_hash IS NOT NULL").fetchone()[0]
        self.assertEqual(before, after)
        paths = {r[0] for r in self.con().execute("SELECT path FROM files")}
        self.assertNotIn("e/small.bin", paths)


if __name__ == "__main__":
    unittest.main(verbosity=2)
