from __future__ import annotations

import logging
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent
_LOG_FMT = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
_backup_logging_configured = False


def _configure_backup_logging() -> None:
    global _backup_logging_configured
    if _backup_logging_configured:
        return

    base = logging.getLogger("backup")
    if base.handlers:
        _backup_logging_configured = True
        return

    base.setLevel(logging.INFO)

    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(_LOG_FMT)
    base.addHandler(stream)

    file_handler = logging.FileHandler(
        _PROJECT_ROOT / "backup.log",
        mode="a",
        encoding="utf-8",
    )
    file_handler.setFormatter(_LOG_FMT)
    base.addHandler(file_handler)

    base.propagate = False
    _backup_logging_configured = True


def get_logger(name: str = "backup") -> logging.Logger:
    _configure_backup_logging()
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    logger.propagate = True
    return logger
