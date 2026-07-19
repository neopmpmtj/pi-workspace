"""Tests for main module."""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backup_PC_tool.main import is_interactive_run, main
from backup_PC_tool.snapshot import SnapshotResult


class TestIsInteractiveRun:
    def test_false_when_unset(self) -> None:
        with patch.dict(os.environ, {"BACKUP_INTERACTIVE": ""}, clear=False):
            assert is_interactive_run() is False

    def test_true_when_set_to_1(self) -> None:
        with patch.dict(os.environ, {"BACKUP_INTERACTIVE": "1"}, clear=False):
            assert is_interactive_run() is True

    def test_false_when_set_to_0(self) -> None:
        with patch.dict(os.environ, {"BACKUP_INTERACTIVE": "0"}, clear=False):
            assert is_interactive_run() is False


class TestMain:
    def test_returns_0_on_success(self, tmp_path: Path) -> None:
        archive_path = tmp_path / ".backup_PC_cache" / "backup_test.tar.gz"
        archive_path.parent.mkdir(parents=True)
        archive_path.touch()
        snap = SnapshotResult(
            archive_path=archive_path,
            archive_name="backup_test.tar.gz",
            created_at_utc="20200101T000000Z",
            root_path=tmp_path,
        )
        with (
            patch("backup_PC_tool.main.init_db"),
            patch("backup_PC_tool.main.prune_old_runs"),
            patch("backup_PC_tool.main.record_run"),
            patch("backup_PC_tool.main.create_snapshot_archive", return_value=snap),
            patch("backup_PC_tool.main.upload_snapshot", return_value="file-id"),
            patch("backup_PC_tool.main.cleanup_old_cache_files"),
        ):
            with patch("pathlib.Path.cwd", return_value=tmp_path):
                assert main() == 0

    def test_returns_1_on_upload_failure(self, tmp_path: Path) -> None:
        archive_path = tmp_path / ".backup_PC_cache" / "backup_test.tar.gz"
        archive_path.parent.mkdir(parents=True)
        archive_path.touch()
        snap = SnapshotResult(
            archive_path=archive_path,
            archive_name="backup_test.tar.gz",
            created_at_utc="20200101T000000Z",
            root_path=tmp_path,
        )
        with (
            patch("backup_PC_tool.main.init_db"),
            patch("backup_PC_tool.main.prune_old_runs"),
            patch("backup_PC_tool.main.record_run"),
            patch("backup_PC_tool.main.create_snapshot_archive", return_value=snap),
            patch("backup_PC_tool.main.upload_snapshot", side_effect=RuntimeError("upload failed")),
        ):
            with patch("pathlib.Path.cwd", return_value=tmp_path):
                assert main() == 1
