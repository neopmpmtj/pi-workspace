"""Tests for the backup history database module."""

from __future__ import annotations

from pathlib import Path

import pytest

from backup_PC_tool.db import (
    BackupRun,
    init_db,
    record_run,
    get_runs,
    get_run_by_id,
    prune_old_runs,
    get_stats,
)


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    """A fresh SQLite database in a temporary directory."""
    p = tmp_path / "test_backup_history.db"
    init_db(p)
    return p


def _make_run(**overrides) -> BackupRun:
    defaults = {
        "timestamp": "2026-07-13T12:00:00+00:00",
        "success": True,
        "exit_code": 0,
        "archive_name": "backup_thinkpad_20260713T120000Z.tar.gz",
        "archive_size_bytes": 1_234_567,
        "drive_file_id": "abc123",
        "duration_seconds": 12.5,
        "trigger_source": "boot",
        "hostname": "testhost",
        "output_log": "2026-07-13 12:00:00 [INFO] Backup completed successfully.",
    }
    defaults.update(overrides)
    return BackupRun(**defaults)


class TestInitDb:
    def test_creates_db_file(self, tmp_path: Path) -> None:
        p = tmp_path / "fresh.db"
        assert not p.exists()
        init_db(p)
        assert p.exists()

    def test_idempotent(self, db_path: Path) -> None:
        init_db(db_path)  # should not raise


class TestRecordAndGetRuns:
    def test_insert_and_retrieve(self, db_path: Path) -> None:
        run_id = record_run(_make_run(), db_path)
        assert isinstance(run_id, int)
        assert run_id > 0

        runs = get_runs(limit=10, db_path=db_path)
        assert len(runs) == 1
        assert runs[0].id == run_id
        assert runs[0].success is True
        assert runs[0].archive_name == "backup_thinkpad_20260713T120000Z.tar.gz"
        assert runs[0].archive_size_bytes == 1_234_567
        assert runs[0].duration_seconds == 12.5
        assert runs[0].trigger_source == "boot"
        assert runs[0].output_log is not None

    def test_failed_run(self, db_path: Path) -> None:
        run = _make_run(success=False, exit_code=1, output_log="Error: something went wrong")
        run_id = record_run(run, db_path)

        fetched = get_run_by_id(run_id, db_path)
        assert fetched is not None
        assert fetched.success is False
        assert fetched.exit_code == 1

    def test_get_runs_order_newest_first(self, db_path: Path) -> None:
        record_run(_make_run(timestamp="2026-07-10T10:00:00+00:00"), db_path)
        record_run(_make_run(timestamp="2026-07-12T10:00:00+00:00"), db_path)
        record_run(_make_run(timestamp="2026-07-11T10:00:00+00:00"), db_path)

        runs = get_runs(limit=10, db_path=db_path)
        timestamps = [r.timestamp for r in runs]
        assert timestamps == sorted(timestamps, reverse=True)

    def test_get_runs_limit(self, db_path: Path) -> None:
        for i in range(5):
            record_run(_make_run(timestamp=f"2026-07-{10+i:02d}T12:00:00+00:00"), db_path)

        runs = get_runs(limit=3, db_path=db_path)
        assert len(runs) == 3

    def test_get_run_by_id_returns_none_for_missing(self, db_path: Path) -> None:
        assert get_run_by_id(9999, db_path) is None

    def test_handles_missing_db_file(self, tmp_path: Path) -> None:
        nonexistent = tmp_path / "does_not_exist.db"
        assert get_runs(db_path=nonexistent) == []
        assert get_run_by_id(1, db_path=nonexistent) is None


class TestPruneOldRuns:
    def test_prunes_old_records(self, db_path: Path) -> None:
        record_run(_make_run(timestamp="2020-01-01T00:00:00+00:00"), db_path)
        record_run(_make_run(timestamp="2026-07-12T12:00:00+00:00"), db_path)

        deleted = prune_old_runs(retention_days=30, db_path=db_path)
        assert deleted == 1

        runs = get_runs(db_path=db_path)
        assert len(runs) == 1
        assert "2026" in runs[0].timestamp

    def test_prune_nothing_when_all_recent(self, db_path: Path) -> None:
        record_run(_make_run(timestamp="2026-07-12T12:00:00+00:00"), db_path)
        record_run(_make_run(timestamp="2026-07-13T12:00:00+00:00"), db_path)

        deleted = prune_old_runs(retention_days=30, db_path=db_path)
        assert deleted == 0
        assert len(get_runs(db_path=db_path)) == 2

    def test_handles_missing_db(self, tmp_path: Path) -> None:
        assert prune_old_runs(db_path=tmp_path / "nope.db") == 0


class TestGetStats:
    def test_stats_empty(self, tmp_path: Path) -> None:
        p = tmp_path / "empty.db"
        init_db(p)
        stats = get_stats(db_path=p)
        assert stats == {"total": 0, "succeeded": 0, "failed": 0, "period_days": 30}

    def test_stats_mixed(self, db_path: Path) -> None:
        record_run(_make_run(timestamp="2026-07-10T10:00:00+00:00", success=True), db_path)
        record_run(_make_run(timestamp="2026-07-11T10:00:00+00:00", success=False, exit_code=1), db_path)
        record_run(_make_run(timestamp="2026-07-12T10:00:00+00:00", success=True), db_path)

        stats = get_stats(db_path=db_path)
        assert stats["total"] == 3
        assert stats["succeeded"] == 2
        assert stats["failed"] == 1
        assert stats["period_days"] == 30

    def test_stats_excludes_old_runs(self, db_path: Path) -> None:
        record_run(_make_run(timestamp="2020-01-01T00:00:00+00:00"), db_path)

        stats = get_stats(retention_days=30, db_path=db_path)
        assert stats["total"] == 0

    def test_handles_missing_db(self, tmp_path: Path) -> None:
        stats = get_stats(db_path=tmp_path / "nope.db")
        assert stats["total"] == 0


class TestOptionalFields:
    def test_nullable_fields_can_be_none(self, db_path: Path) -> None:
        run = _make_run(
            exit_code=None,
            archive_name=None,
            archive_size_bytes=None,
            drive_file_id=None,
            duration_seconds=None,
            output_log=None,
        )
        run_id = record_run(run, db_path)
        fetched = get_run_by_id(run_id, db_path)
        assert fetched is not None
        assert fetched.exit_code is None
        assert fetched.archive_name is None
        assert fetched.drive_file_id is None