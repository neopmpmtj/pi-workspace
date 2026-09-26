"""
Centralized logging for the explain_like package.

Console (stdout) + rotating file handler in <app>/logs/.
"""

import logging
import logging.handlers
import sys
from pathlib import Path

from . import APP_ROOT

LOG_DIR = APP_ROOT / "logs"
LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def get_logger(name: str, console_level: str = "INFO", file_level: str = "DEBUG") -> logging.Logger:
    """Create or retrieve a logger with console + rotating file handlers."""
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    formatter = logging.Formatter(fmt=LOG_FORMAT, datefmt=DATE_FORMAT)

    console = logging.StreamHandler(sys.stdout)
    console.setLevel(getattr(logging, console_level.upper()))
    console.setFormatter(formatter)
    logger.addHandler(console)

    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        fh = logging.handlers.RotatingFileHandler(
            LOG_DIR / f"{name}.log",
            maxBytes=5 * 1024 * 1024,
            backupCount=3,
            encoding="utf-8",
        )
        fh.setLevel(getattr(logging, file_level.upper()))
        fh.setFormatter(formatter)
        logger.addHandler(fh)
    except Exception:  # pragma: no cover - logging must never break the app
        pass

    return logger


def set_console_level(name: str, level: str) -> None:
    """Bump an existing logger's console handler to the given level."""
    logger = logging.getLogger(name)
    lvl = getattr(logging, level.upper(), logging.INFO)
    for handler in logger.handlers:
        if isinstance(handler, logging.StreamHandler):
            handler.setLevel(lvl)
