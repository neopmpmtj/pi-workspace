"""SQLite-based backup execution history."""

from __future__ import annotations

import socket
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from .log import get_logger

logger = get_logger("backup.db")

# Database lives at the tool root, sibling to src/
DB_PATH = Path(__file__).resolve().parent.parent.parent / "backup_history.db"

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS backup_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 0,
    exit_code INTEGER,
    archive_name TEXT,
    archive_size_bytes INTEGER,
    drive_file_id TEXT,
    duration_seconds REAL,
    trigger_source TEXT NOT NULL DEFAULT 'unknown',
    hostname TEXT NOT NULL,
    output_log TEXT
);

CREATE INDEX IF NOT EXISTS idx_backup_runs_timestamp ON backup_runs(timestamp);
"""


@dataclass
class BackupRun:
    """A single backup execution record."""

    id: Optional[int] = None
    timestamp: str = ""
    success: bool = False
    exit_code: Optional[int] = None
    archive_name: Optional[str] = None
    archive_size_bytes: Optional[int] = None
    drive_file_id: Optional[str] = None
    duration_seconds: Optional[float] = None
    trigger_source: str = "unknown"
    hostname: str = ""
    output_log: Optional[str] = None


def _get_connection(db_path: Optional[Path] = None) -> sqlite3.Connection:
    path = db_path or DB_PATH
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db(db_path: Optional[Path] = None) -> None:
    """Create tables and indexes if they don't exist. Idempotent."""
    path = db_path or DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = _get_connection(path)
    try:
        conn.executescript(SCHEMA_SQL)
        conn.commit()
        logger.debug(f"Database initialised at {path}")
    finally:
        conn.close()


def record_run(run: BackupRun, db_path: Optional[Path] = None) -> int:
    """Insert a backup run record. Returns the new row id."""
    path = db_path or DB_PATH
    conn = _get_connection(path)
    try:
        cursor = conn.execute(
            """INSERT INTO backup_runs
               (timestamp, success, exit_code, archive_name, archive_size_bytes,
                drive_file_id, duration_seconds, trigger_source, hostname, output_log)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                run.timestamp,
                1 if run.success else 0,
                run.exit_code,
                run.archive_name,
                run.archive_size_bytes,
                run.drive_file_id,
                run.duration_seconds,
                run.trigger_source,
                run.hostname,
                run.output_log,
            ),
        )
        conn.commit()
        row_id = cursor.lastrowid
        logger.debug(f"Recorded backup run #{row_id} ({'success' if run.success else 'failure'})")
        return row_id
    finally:
        conn.close()


def get_runs(limit: int = 20, db_path: Optional[Path] = None) -> list[BackupRun]:
    """Return the most recent runs, newest first."""
    path = db_path or DB_PATH
    if not path.exists():
        return []
    conn = _get_connection(path)
    try:
        rows = conn.execute(
            "SELECT * FROM backup_runs ORDER BY timestamp DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [_row_to_run(r) for r in rows]
    finally:
        conn.close()


def get_run_by_id(run_id: int, db_path: Optional[Path] = None) -> Optional[BackupRun]:
    """Return a single run by id, or None."""
    path = db_path or DB_PATH
    if not path.exists():
        return None
    conn = _get_connection(path)
    try:
        row = conn.execute(
            "SELECT * FROM backup_runs WHERE id = ?", (run_id,)
        ).fetchone()
        return _row_to_run(row) if row else None
    finally:
        conn.close()


def prune_old_runs(retention_days: int = 30, db_path: Optional[Path] = None) -> int:
    """Delete records older than retention_days. Returns number deleted."""
    path = db_path or DB_PATH
    if not path.exists():
        return 0
    cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).isoformat()
    conn = _get_connection(path)
    try:
        cursor = conn.execute(
            "DELETE FROM backup_runs WHERE timestamp < ?", (cutoff,)
        )
        conn.commit()
        deleted = cursor.rowcount
        if deleted > 0:
            logger.info(
                "Pruned %d backup history record(s) older than %d days",
                deleted,
                retention_days,
            )
        return deleted
    finally:
        conn.close()


def get_stats(retention_days: int = 30, db_path: Optional[Path] = None) -> dict:
    """Return summary stats for the given period."""
    path = db_path or DB_PATH
    if not path.exists():
        return {"total": 0, "succeeded": 0, "failed": 0, "period_days": retention_days}
    cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).isoformat()
    conn = _get_connection(path)
    try:
        total = conn.execute(
            "SELECT COUNT(*) FROM backup_runs WHERE timestamp >= ?", (cutoff,)
        ).fetchone()[0]
        succeeded = conn.execute(
            "SELECT COUNT(*) FROM backup_runs WHERE timestamp >= ? AND success = 1",
            (cutoff,),
        ).fetchone()[0]
        return {
            "total": total,
            "succeeded": succeeded,
            "failed": total - succeeded,
            "period_days": retention_days,
        }
    finally:
        conn.close()


def _row_to_run(row: sqlite3.Row) -> BackupRun:
    return BackupRun(
        id=row["id"],
        timestamp=row["timestamp"],
        success=bool(row["success"]),
        exit_code=row["exit_code"],
        archive_name=row["archive_name"],
        archive_size_bytes=row["archive_size_bytes"],
        drive_file_id=row["drive_file_id"],
        duration_seconds=row["duration_seconds"],
        trigger_source=row["trigger_source"],
        hostname=row["hostname"],
        output_log=row["output_log"],
    )