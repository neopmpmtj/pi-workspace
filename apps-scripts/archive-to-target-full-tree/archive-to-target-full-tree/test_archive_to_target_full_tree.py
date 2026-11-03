#!/usr/bin/env python3
"""Behavior tests for archive_to_target_full_tree."""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import archive_to_target_full_tree as archive_tool


NOW = datetime(2026, 11, 2, 17, 24, 16, 219000)
STAMP = "2026-11-02T17-24-16-219"
NOW_2 = datetime(2026, 11, 2, 18, 0, 0, 1000)
STAMP_2 = "2026-11-02T18-00-00-001"


class ArchiveToTargetFullTreeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name) / "home"
        self.home.mkdir()
        self.target = Path(self.tmp.name) / "archive"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def run_archive(
        self,
        argv: list[str],
        now: datetime | None = None,
    ) -> tuple[int, str]:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = archive_tool.run_archive_to_target_full_tree(
                argv,
                home=self.home,
                now=NOW if now is None else now,
                script_dir=Path(self.tmp.name),
            )
        return code, output.getvalue()

    def write_config(
        self,
        sources: list[Path],
        target: Path | None = None,
        include_target: bool = True,
        name: str = "job.json",
    ) -> Path:
        section: dict[str, object] = {
            "sources": [str(source) for source in sources],
        }
        if include_target:
            section["target"] = str(self.target if target is None else target)
        path = Path(self.tmp.name) / name
        path.write_text(
            json.dumps({archive_tool.SECTION_NAME: section}),
            encoding="utf-8",
        )
        return path

    def test_make_stamp(self) -> None:
        self.assertEqual(archive_tool.make_stamp(NOW), STAMP)
        self.assertEqual(archive_tool.make_stamp(NOW_2), STAMP_2)

    def test_normalize_expands_tilde(self) -> None:
        self.assertEqual(
            archive_tool.normalize_path("~/archive-to-target-full-tree-tilde"),
            Path.home() / "archive-to-target-full-tree-tilde",
        )

    def test_default_config_file(self) -> None:
        path = Path(archive_tool.__file__).resolve().parent / archive_tool.CONFIG_FILENAME
        loaded = archive_tool.read_archive_to_target_full_tree_config(path)
        self.assertIsInstance(loaded["target"], str)
        self.assertTrue(loaded["target"])
        self.assertEqual(loaded["sources"], [])

    def test_file_stamp_path(self) -> None:
        source = self.home / ".pi" / "agent" / "example.md"
        source.parent.mkdir(parents=True)
        source.write_text("hello")
        target = self.home / ".pi" / "archive"
        code, out = self.run_archive(["--source", str(source), "--target", str(target)])
        dest = target / ".pi" / "agent" / f"{STAMP}_example.md"
        self.assertEqual(code, 0, out)
        self.assertEqual(out.strip(), f"[ok] {source} -> {dest}")
        self.assertEqual(dest.read_text(), "hello")
        self.assertFalse(source.exists())

    def test_folder_merge_does_not_overwrite(self) -> None:
        agent = self.home / ".pi" / "agent"
        (agent / "sub").mkdir(parents=True)
        (agent / "empty").mkdir()
        (agent / "example.md").write_text("v1")
        (agent / ".gitignore").write_text("git")
        (agent / "sub" / "nested.txt").write_text("nested")
        target = self.home / ".pi" / "archive"

        code, out = self.run_archive(["--source", str(agent), "--target", str(target)])
        self.assertEqual(code, 0, out)
        self.assertFalse(agent.exists())
        archived = target / ".pi" / "agent"
        self.assertEqual((archived / f"{STAMP}_example.md").read_text(), "v1")
        self.assertEqual((archived / f"{STAMP}_.gitignore").read_text(), "git")
        self.assertEqual((archived / "sub" / f"{STAMP}_nested.txt").read_text(), "nested")
        self.assertTrue((archived / "empty").is_dir())
        self.assertEqual(list((archived / "empty").iterdir()), [])
        self.assertFalse((archived / f"{STAMP}_sub").exists())
        self.assertFalse((target / ".pi" / f"{STAMP}_agent").exists())
        self.assertIn(f"[ok] {agent / 'empty'} -> {archived / 'empty'}", out)

        agent.mkdir()
        (agent / "example.md").write_text("v2")
        (agent / "fresh.md").write_text("fresh")
        code, out = self.run_archive(
            ["--source", str(agent), "--target", str(target)],
            now=NOW_2,
        )
        self.assertEqual(code, 0, out)
        self.assertFalse(agent.exists())
        self.assertEqual((archived / f"{STAMP}_example.md").read_text(), "v1")
        self.assertEqual((archived / f"{STAMP_2}_example.md").read_text(), "v2")
        self.assertEqual((archived / f"{STAMP_2}_fresh.md").read_text(), "fresh")
        self.assertEqual((archived / "sub" / f"{STAMP}_nested.txt").read_text(), "nested")
        names = sorted(path.name for path in archived.glob("*example.md"))
        self.assertEqual(names, [f"{STAMP}_example.md", f"{STAMP_2}_example.md"])

    def test_collision_suffix(self) -> None:
        source = self.home / "proj" / "example.md"
        source.parent.mkdir(parents=True)
        source.write_text("new")
        dest_dir = self.target / "proj"
        dest_dir.mkdir(parents=True)
        (dest_dir / f"{STAMP}_example.md").write_text("keep")
        (dest_dir / f"{STAMP}-2_example.md").write_text("older")
        code, out = self.run_archive(["--source", str(source), "--target", str(self.target)])
        landed = dest_dir / f"{STAMP}-3_example.md"
        self.assertEqual(code, 0, out)
        self.assertEqual(landed.read_text(), "new")
        self.assertEqual((dest_dir / f"{STAMP}_example.md").read_text(), "keep")
        self.assertEqual((dest_dir / f"{STAMP}-2_example.md").read_text(), "older")
        self.assertFalse(source.exists())
        self.assertIn(str(landed), out)

    def test_dry_run_does_not_move(self) -> None:
        source = self.home / "proj"
        (source / "empty").mkdir(parents=True)
        (source / "a.md").write_text("a")
        code, out = self.run_archive(
            ["--source", str(source), "--target", str(self.target), "--dry-run"]
        )
        self.assertEqual(code, 0, out)
        self.assertEqual((source / "a.md").read_text(), "a")
        self.assertTrue((source / "empty").is_dir())
        self.assertFalse(self.target.exists())
        self.assertIn(f"{STAMP}_a.md", out)
        self.assertIn(str(self.target / "proj" / "empty"), out)

    def test_empty_directory(self) -> None:
        source = self.home / "proj" / "empty"
        source.mkdir(parents=True)
        code, out = self.run_archive(["--source", str(source), "--target", str(self.target)])
        dest = self.target / "proj" / "empty"
        self.assertEqual(code, 0, out)
        self.assertFalse(source.exists())
        self.assertTrue(dest.is_dir())
        self.assertEqual(list(dest.iterdir()), [])
        self.assertIn(f"[ok] {source} -> {dest}", out)

    def test_refuse_source_outside_home(self) -> None:
        outside = Path(self.tmp.name) / "outside.md"
        outside.write_text("out")
        code, out = self.run_archive(["--source", str(outside), "--target", str(self.target)])
        self.assertEqual(code, 1, out)
        self.assertIn("source is not under home", out)
        self.assertEqual(outside.read_text(), "out")
        self.assertFalse(self.target.exists())

    def test_refuse_target_inside_source(self) -> None:
        source = self.home / "proj"
        source.mkdir()
        (source / "a.md").write_text("a")
        nested = source / "archive"
        code, out = self.run_archive(["--source", str(source), "--target", str(nested)])
        self.assertEqual(code, 1, out)
        self.assertIn("target is inside source", out)
        self.assertEqual((source / "a.md").read_text(), "a")
        self.assertFalse(nested.exists())

    def test_refuse_source_inside_target(self) -> None:
        target = self.home / "archive"
        source = target / "proj" / "a.md"
        source.parent.mkdir(parents=True)
        source.write_text("a")
        code, out = self.run_archive(["--source", str(source), "--target", str(target)])
        self.assertEqual(code, 1, out)
        self.assertIn("source is inside target", out)
        self.assertEqual(source.read_text(), "a")
        self.assertEqual(list(source.parent.glob(f"{STAMP}_*")), [])

    def test_refuse_same_path(self) -> None:
        source = self.home / "proj"
        source.mkdir()
        (source / "a.md").write_text("a")
        code, out = self.run_archive(["--source", str(source), "--target", str(source)])
        self.assertEqual(code, 1, out)
        self.assertIn("source and target are the same path", out)
        self.assertEqual((source / "a.md").read_text(), "a")

    def test_explicit_missing_source_fails(self) -> None:
        missing = self.home / "nope.md"
        code, out = self.run_archive(["--source", str(missing), "--target", str(self.target)])
        self.assertEqual(code, 1, out)
        self.assertIn("[FAIL]", out)
        self.assertIn("not found", out)
        self.assertFalse(self.target.exists())

    def test_list_missing_source_skips(self) -> None:
        present = self.home / "present.md"
        present.write_text("p")
        missing = self.home / "missing.md"
        config = self.write_config([missing, present], name="list.json")
        code, out = self.run_archive(["--list", str(config), "--target", str(self.target)])
        self.assertEqual(code, 0, out)
        self.assertIn(f"[ok] {missing} skipped, not found", out)
        self.assertFalse(present.exists())
        self.assertEqual((self.target / f"{STAMP}_present.md").read_text(), "p")

    def test_source_replaces_list_even_when_list_is_missing(self) -> None:
        source = self.home / "b.md"
        source.write_text("b")
        code, out = self.run_archive(
            [
                "--source",
                str(source),
                "--list",
                str(Path(self.tmp.name) / "missing-list.json"),
                "--target",
                str(self.target),
            ]
        )
        self.assertEqual(code, 0, out)
        self.assertFalse(source.exists())
        self.assertEqual((self.target / f"{STAMP}_b.md").read_text(), "b")

    def test_list_sources_use_config_target(self) -> None:
        source = self.home / "a.md"
        source.write_text("a")
        wrong = Path(self.tmp.name) / "wrong"
        list_file = self.write_config([source], target=wrong, name="list.json")
        config_file = self.write_config([], target=self.target, name="config.json")
        code, out = self.run_archive(["--config", str(config_file), "--list", str(list_file)])
        self.assertEqual(code, 0, out)
        self.assertEqual((self.target / f"{STAMP}_a.md").read_text(), "a")
        self.assertFalse(wrong.exists())
        self.assertFalse(source.exists())

    def test_target_overrides_config(self) -> None:
        source = self.home / "a.md"
        source.write_text("a")
        wrong = Path(self.tmp.name) / "wrong"
        config = self.write_config([source], target=wrong, name="config.json")
        code, out = self.run_archive(
            ["--config", str(config), "--target", str(self.target)]
        )
        self.assertEqual(code, 0, out)
        self.assertEqual((self.target / f"{STAMP}_a.md").read_text(), "a")
        self.assertFalse(wrong.exists())

    def test_missing_target_fails(self) -> None:
        source = self.home / "a.md"
        source.write_text("a")
        config = self.write_config([source], include_target=False, name="config.json")
        code, out = self.run_archive(["--config", str(config)])
        self.assertEqual(code, 1, out)
        self.assertIn("target is not set", out)
        self.assertEqual(source.read_text(), "a")

    def test_empty_source_list_exits_zero(self) -> None:
        config = self.write_config([], name="config.json")
        code, out = self.run_archive(["--config", str(config)])
        self.assertEqual(code, 0, out)
        self.assertEqual(out, "")
        self.assertFalse(self.target.exists())

    def test_failure_does_not_stop_the_batch(self) -> None:
        outside = Path(self.tmp.name) / "outside.md"
        outside.write_text("out")
        inside = self.home / "inside.md"
        inside.write_text("in")
        code, out = self.run_archive(
            ["--source", str(outside), "--source", str(inside), "--target", str(self.target)]
        )
        self.assertEqual(code, 1, out)
        self.assertIn("[FAIL]", out)
        self.assertIn("[ok]", out)
        self.assertEqual(outside.read_text(), "out")
        self.assertFalse(inside.exists())
        self.assertEqual((self.target / f"{STAMP}_inside.md").read_text(), "in")

    def test_folder_sibling_failure_keeps_going(self) -> None:
        source = self.home / "proj"
        (source / "sub").mkdir(parents=True)
        (source / "good.txt").write_text("good")
        (source / "sub" / "bad.txt").write_text("bad")
        blocker = self.target / "proj" / "sub"
        blocker.parent.mkdir(parents=True)
        blocker.write_text("not-a-dir")
        code, out = self.run_archive(["--source", str(source), "--target", str(self.target)])
        self.assertEqual(code, 1, out)
        self.assertIn("[ok]", out)
        self.assertIn("[FAIL]", out)
        self.assertEqual((self.target / "proj" / f"{STAMP}_good.txt").read_text(), "good")
        self.assertEqual((source / "sub" / "bad.txt").read_text(), "bad")
        self.assertEqual(blocker.read_text(), "not-a-dir")

    def test_directory_symlink_is_not_followed(self) -> None:
        outside = Path(self.tmp.name) / "outside"
        outside.mkdir()
        (outside / "secret.md").write_text("secret")
        source = self.home / "proj"
        source.mkdir()
        (source / "keep.md").write_text("keep")
        (source / "linkdir").symlink_to(outside, target_is_directory=True)
        code, out = self.run_archive(["--source", str(source), "--target", str(self.target)])
        self.assertEqual(code, 0, out)
        self.assertFalse(source.exists())
        self.assertEqual((outside / "secret.md").read_text(), "secret")
        link = self.target / "proj" / f"{STAMP}_linkdir"
        self.assertTrue(link.is_symlink())
        self.assertEqual(os.readlink(link), str(outside))
        self.assertFalse((self.target / "proj" / "linkdir").exists())
        self.assertEqual((self.target / "proj" / f"{STAMP}_keep.md").read_text(), "keep")
        self.assertEqual(files_under(self.target, "secret.md"), [])

    def test_given_path_is_not_resolved(self) -> None:
        real = self.home / "real"
        real.mkdir()
        (real / "a.md").write_text("a")
        link = self.home / "link"
        link.symlink_to(real, target_is_directory=True)
        source = link / "a.md"
        code, out = self.run_archive(["--source", str(source), "--target", str(self.target)])
        dest = self.target / "link" / f"{STAMP}_a.md"
        self.assertEqual(code, 0, out)
        self.assertEqual(dest.read_text(), "a")
        self.assertFalse((self.target / "real").exists())
        self.assertFalse((real / "a.md").exists())
        self.assertTrue(link.is_symlink())

    def last_run(self) -> dict:
        path = Path(self.tmp.name) / archive_tool.LAST_FILENAME
        return archive_tool.read_archive_to_target_full_tree_last_run(path)

    def test_help_includes_undo(self) -> None:
        help_text = archive_tool.build_parser().format_help()
        self.assertIn("--undo", help_text)
        self.assertIn("archive_to_target_full_tree.py --undo", help_text)

    def test_undo_restores_folder_and_second_undo_is_a_noop(self) -> None:
        source = self.home / "proj"
        (source / "sub").mkdir(parents=True)
        (source / "empty").mkdir()
        (source / "a.md").write_text("a")
        (source / "sub" / "b.md").write_text("b")
        self.target.mkdir()
        (self.target / "keep.txt").write_text("keep")
        code, out = self.run_archive(["--source", str(source), "--target", str(self.target)])
        self.assertEqual(code, 0, out)
        self.assertFalse(source.exists())

        code, out = self.run_archive(["--undo"])
        self.assertEqual(code, 0, out)
        self.assertEqual((source / "a.md").read_text(), "a")
        self.assertEqual((source / "sub" / "b.md").read_text(), "b")
        self.assertTrue((source / "empty").is_dir())
        self.assertFalse((self.target / "proj" / f"{STAMP}_a.md").exists())
        self.assertFalse((self.target / "proj" / "empty").exists())
        self.assertEqual((self.target / "keep.txt").read_text(), "keep")
        self.assertTrue(self.target.is_dir())
        self.assertEqual(self.last_run()["status"], "undone")

        code, out = self.run_archive(["--undo"])
        self.assertEqual(code, 0, out)
        self.assertIn("nothing to undo", out)
        self.assertEqual((source / "a.md").read_text(), "a")
        self.assertEqual((source / "sub" / "b.md").read_text(), "b")

    def test_undo_does_not_overwrite_when_both_exist(self) -> None:
        source = self.home / "a.md"
        source.write_text("archived")
        code, out = self.run_archive(["--source", str(source), "--target", str(self.target)])
        self.assertEqual(code, 0, out)
        dest = self.target / f"{STAMP}_a.md"
        source.write_text("recreated")
        code, out = self.run_archive(["--undo"])
        self.assertEqual(code, 1, out)
        self.assertIn("both exist", out)
        self.assertEqual(source.read_text(), "recreated")
        self.assertEqual(dest.read_text(), "archived")
        self.assertEqual(self.last_run()["status"], "applied")

    def test_undo_dry_run_does_not_change_files_or_journal(self) -> None:
        source = self.home / "a.md"
        source.write_text("a")
        code, out = self.run_archive(["--source", str(source), "--target", str(self.target)])
        self.assertEqual(code, 0, out)
        dest = self.target / f"{STAMP}_a.md"
        code, out = self.run_archive(["--undo", "--dry-run"])
        self.assertEqual(code, 0, out)
        self.assertIn(str(dest), out)
        self.assertIn(str(source), out)
        self.assertFalse(source.exists())
        self.assertEqual(dest.read_text(), "a")
        self.assertEqual(self.last_run()["status"], "applied")

    def test_later_archive_replaces_the_only_last_run(self) -> None:
        first = self.home / "a.md"
        second = self.home / "b.md"
        first.write_text("a")
        second.write_text("b")
        code, out = self.run_archive(["--source", str(first), "--target", str(self.target)])
        self.assertEqual(code, 0, out)
        code, out = self.run_archive(
            ["--source", str(second), "--target", str(self.target), "--dry-run"]
        )
        self.assertEqual(code, 0, out)
        self.assertTrue(second.exists())
        self.assertEqual(self.last_run()["moves"][0]["source"], str(first))

        code, out = self.run_archive(["--source", str(second), "--target", str(self.target)])
        self.assertEqual(code, 0, out)
        moves = self.last_run()["moves"]
        self.assertEqual([item["source"] for item in moves], [str(second)])

        code, out = self.run_archive(["--undo"])
        self.assertEqual(code, 0, out)
        self.assertEqual(second.read_text(), "b")
        self.assertFalse(first.exists())
        self.assertEqual((self.target / f"{STAMP}_a.md").read_text(), "a")
        self.assertFalse((self.target / f"{STAMP}_b.md").exists())

    def test_undo_without_a_journal_is_a_noop(self) -> None:
        code, out = self.run_archive(["--undo"])
        self.assertEqual(code, 0, out)
        self.assertIn("nothing to undo", out)

    def test_undo_rejects_source(self) -> None:
        source = self.home / "a.md"
        source.write_text("a")
        code, out = self.run_archive(
            ["--undo", "--source", str(source), "--target", str(self.target)]
        )
        self.assertEqual(code, 1, out)
        self.assertIn("cannot be combined", out)
        self.assertEqual(source.read_text(), "a")
        self.assertFalse((Path(self.tmp.name) / archive_tool.LAST_FILENAME).exists())


def files_under(root: Path, name: str) -> list[Path]:
    found: list[Path] = []
    if not root.exists():
        return found
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        current = Path(dirpath)
        dirnames[:] = [entry for entry in dirnames if not (current / entry).is_symlink()]
        if name in filenames:
            found.append(current / name)
    return found


if __name__ == "__main__":
    unittest.main()
