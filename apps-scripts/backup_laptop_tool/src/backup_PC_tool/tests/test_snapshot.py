"""Tests for snapshot module."""

from __future__ import annotations

import tarfile
from pathlib import Path

import pytest

from backup_PC_tool.snapshot import (
    SnapshotResult,
    create_snapshot_archive,
    cleanup_old_cache_files,
)


class TestCreateSnapshotArchive:
    def test_creates_valid_tar_gz(
        self, tmp_source_dir: Path, blacklist: list[str]
    ) -> None:
        snap = create_snapshot_archive(
            source_dir=tmp_source_dir,
            cache_dir=tmp_source_dir / ".backup_PC_cache",
            blacklist=blacklist,
        )
        assert isinstance(snap, SnapshotResult)
        assert snap.archive_path.exists()
        assert snap.archive_path.suffixes == [".tar", ".gz"]
        assert snap.root_path == tmp_source_dir.resolve()
        assert "backup_" in snap.archive_name
        assert ".tar.gz" in snap.archive_name

    def test_archive_contains_kept_files(
        self, tmp_source_dir: Path, blacklist: list[str]
    ) -> None:
        snap = create_snapshot_archive(
            source_dir=tmp_source_dir,
            cache_dir=tmp_source_dir / ".backup_PC_cache",
            blacklist=blacklist,
        )
        with tarfile.open(snap.archive_path, "r:gz") as tf:
            names = tf.getnames()
        assert "keep" in names
        assert "keep/file.txt" in names
        assert "root_file.txt" in names

    def test_archive_excludes_blacklisted_dirs(
        self, tmp_source_dir: Path, blacklist: list[str]
    ) -> None:
        snap = create_snapshot_archive(
            source_dir=tmp_source_dir,
            cache_dir=tmp_source_dir / ".backup_PC_cache",
            blacklist=blacklist,
        )
        with tarfile.open(snap.archive_path, "r:gz") as tf:
            names = tf.getnames()
        assert not any(n.startswith(".git") for n in names)
        assert not any(n.startswith("venv") for n in names)

    def test_archive_excludes_node_modules(self, tmp_path: Path) -> None:
        """Regression: node_modules was missing from the live blacklist and
        41 MB of agent/npm/node_modules was being snapshotted every run."""
        (tmp_path / "project" / "node_modules" / "left-pad").mkdir(parents=True)
        (tmp_path / "project" / "node_modules" / "left-pad" / "index.js").write_text("x")
        (tmp_path / "project" / "src").mkdir()
        (tmp_path / "project" / "src" / "app.js").write_text("// keep")
        snap = create_snapshot_archive(
            source_dir=tmp_path / "project",
            cache_dir=tmp_path / ".backup_PC_cache",
            blacklist=["node_modules", ".backup_PC_cache"],
        )
        with tarfile.open(snap.archive_path, "r:gz") as tf:
            names = tf.getnames()
        assert not any("node_modules" in n for n in names)
        assert "src/app.js" in names

    def test_archive_excludes_absolute_blacklisted_dir(
        self, tmp_source_dir: Path, blacklist: list[str]
    ) -> None:
        abs_blacklisted = tmp_source_dir / "code archive"
        abs_blacklisted.mkdir()
        (abs_blacklisted / "secret.txt").write_text("ignored")

        snap = create_snapshot_archive(
            source_dir=tmp_source_dir,
            cache_dir=tmp_source_dir / ".backup_PC_cache",
            blacklist=blacklist + [str(abs_blacklisted)],
        )

        with tarfile.open(snap.archive_path, "r:gz") as tf:
            names = tf.getnames()

        assert not any(n.startswith("code archive") for n in names)

    def test_cache_dir_created(self, tmp_path: Path) -> None:
        cache = tmp_path / ".backup_PC_cache"
        assert not cache.exists()
        create_snapshot_archive(
            source_dir=tmp_path,
            cache_dir=cache,
            blacklist=[".git"],
        )
        assert cache.exists()
        assert cache.is_dir()

    def test_default_cache_dir_under_source(self, tmp_path: Path) -> None:
        """When cache_dir is None, it defaults to source_dir/.backup_PC_cache."""
        (tmp_path / "file.txt").write_text("x")
        snap = create_snapshot_archive(
            source_dir=tmp_path,
            cache_dir=None,
            blacklist=[".backup_PC_cache"],
        )
        assert snap.archive_path.parent == (tmp_path / ".backup_PC_cache").resolve()
        assert snap.archive_path.exists()

    def test_archive_does_not_contain_itself(self, tmp_path: Path) -> None:
        """The archive must not include its own .tar.gz when cache is inside source."""
        (tmp_path / "file.txt").write_text("x")
        snap = create_snapshot_archive(
            source_dir=tmp_path,
            cache_dir=tmp_path / ".backup_PC_cache",
            blacklist=[".backup_PC_cache"],
        )
        with tarfile.open(snap.archive_path, "r:gz") as tf:
            names = tf.getnames()
        assert not any(n == snap.archive_path.name for n in names)
        assert not any(".backup_PC_cache" in n for n in names)

    def test_empty_source_dir_produces_valid_archive(self, tmp_path: Path) -> None:
        snap = create_snapshot_archive(
            source_dir=tmp_path,
            cache_dir=tmp_path / ".backup_PC_cache",
            blacklist=[".git"],
        )
        assert snap.archive_path.exists()
        with tarfile.open(snap.archive_path, "r:gz") as tf:
            tf.getnames()  # must not raise


class TestCleanupOldCacheFiles:
    def test_keeps_only_one_file(self, tmp_path: Path) -> None:
        cache = tmp_path / ".backup_PC_cache"
        cache.mkdir()
        f1 = cache / "backup_host_20200101T000000Z.tar.gz"
        f2 = cache / "backup_host_20200102T000000Z.tar.gz"
        f3 = cache / "backup_host_20200103T000000Z.tar.gz"
        f1.touch()
        f2.touch()
        f3.touch()
        cleanup_old_cache_files(cache, f2)
        assert not f1.exists()
        assert f2.exists()
        assert not f3.exists()

    def test_handles_single_file(self, tmp_path: Path) -> None:
        cache = tmp_path / ".backup_PC_cache"
        cache.mkdir()
        f = cache / "backup_host_20200101T000000Z.tar.gz"
        f.touch()
        cleanup_old_cache_files(cache, f)
        assert f.exists()

    def test_handles_empty_dir(self, tmp_path: Path) -> None:
        cache = tmp_path / ".backup_PC_cache"
        cache.mkdir()
        cleanup_old_cache_files(cache, tmp_path / "nonexistent.tar.gz")

    def test_handles_missing_cache_dir(self, tmp_path: Path) -> None:
        cache = tmp_path / "does_not_exist"
        cleanup_old_cache_files(cache, tmp_path / "x.tar.gz")
        assert not cache.exists()

    def test_ignores_non_tar_gz_files(self, tmp_path: Path) -> None:
        cache = tmp_path / ".backup_PC_cache"
        cache.mkdir()
        tar = cache / "backup_20200101.tar.gz"
        other = cache / "other.txt"
        tar.touch()
        other.touch()
        cleanup_old_cache_files(cache, tar)
        assert tar.exists()
        assert other.exists()
