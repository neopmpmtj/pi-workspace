from __future__ import annotations

import io
import logging
import os
import socket
import time
from datetime import datetime, timezone
from pathlib import Path

from .snapshot import create_snapshot_archive, cleanup_old_cache_files
from .gdrive import upload_snapshot
from .log import get_logger
from .db import init_db, record_run, prune_old_runs, BackupRun


logger = get_logger("backup.main")

# Cache directory lives inside the backup tool itself, not in the backed-up tree
TOOL_ROOT = Path(__file__).resolve().parent.parent.parent
CACHE_DIR = TOOL_ROOT / ".backup_PC_cache"


def is_interactive_run() -> bool:
    """
    You should run manually once to authorize.
    For cron/systemd runs, this must be False.

    Set BACKUP_INTERACTIVE=1 to force interactive mode.
    """
    return os.environ.get("BACKUP_INTERACTIVE", "").strip() == "1"


def _get_trigger_source() -> str:
    """Determine what triggered this backup run."""
    return os.environ.get("BACKUP_TRIGGER", "cli").strip() or "cli"


def main() -> int:
    # ── Initialise DB and prune old history ────────────────────────────
    init_db()
    prune_old_runs(retention_days=30)

    # ── Capture all log output into a string for permanent storage ─────
    log_capture = io.StringIO()
    capture_handler = logging.StreamHandler(log_capture)
    capture_handler.setLevel(logging.INFO)
    # Reuse the same format as the other handlers
    capture_handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
    )
    root_logger = logging.getLogger("backup")
    root_logger.addHandler(capture_handler)

    # Track how long the entire backup takes
    start_time = time.time()
    hostname = socket.gethostname()
    trigger = _get_trigger_source()

    # Per-run state (populated as we go)
    snap = None
    success = False
    exit_code = 1
    drive_file_id: str | None = None

    try:
        cwd = Path.cwd()

        logger.info(f"Backup working directory: {cwd}")
        logger.info(f"Trigger: {trigger}  |  Host: {hostname}")

        # Create snapshot archive (cache goes inside the backup tool directory)
        snap = create_snapshot_archive(source_dir=cwd, cache_dir=CACHE_DIR)

        # Upload to Drive
        drive_file_id = upload_snapshot(
            snap.archive_path, interactive=is_interactive_run()
        )

        # Cleanup old cache files after successful upload (keep only the most recent)
        cleanup_old_cache_files(CACHE_DIR, snap.archive_path)

        logger.info("Backup completed successfully.")
        success = True
        exit_code = 0
        return 0

    except Exception as e:
        logger.exception(f"Backup failed: {e}")
        success = False
        exit_code = 1
        return 1

    finally:
        duration = time.time() - start_time
        root_logger.removeHandler(capture_handler)
        capture_handler.close()

        # ── Persist this run to the history database ─────────────────
        try:
            archive_size = (
                snap.archive_path.stat().st_size if snap and snap.archive_path.exists() else None
            )
            run = BackupRun(
                timestamp=datetime.now(timezone.utc).isoformat(),
                success=success,
                exit_code=exit_code,
                archive_name=snap.archive_name if snap else None,
                archive_size_bytes=archive_size,
                drive_file_id=drive_file_id,
                duration_seconds=round(duration, 3),
                trigger_source=trigger,
                hostname=hostname,
                output_log=log_capture.getvalue().strip() or None,
            )
            record_run(run)
        except Exception as db_err:
            logger.warning(f"Failed to record backup run in history DB: {db_err}")


if __name__ == "__main__":
    raise SystemExit(main())
