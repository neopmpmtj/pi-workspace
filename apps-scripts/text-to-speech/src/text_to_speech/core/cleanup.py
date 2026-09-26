"""
Audio file retention cleanup.

Deletes generated audio files (tts_*.mp3/wav/...) in the output directory
that are older than a configurable number of days.

Designed to run from cron:
    0 3 * * * cd $APP_DIR && $VENV/python -m text_to_speech --cleanup-audio
(see install_cleanup_cron.sh and the README)
"""

import time
from pathlib import Path
from typing import Dict, Union

from ..logging_utils import get_logger

logger = get_logger("cleanup")

AUDIO_EXTENSIONS = {".mp3", ".wav", ".ogg", ".opus", ".flac", ".m4a", ".aac"}
FILE_PREFIX = "tts_"


def cleanup_audio(
    output_dir: Union[str, Path],
    retention_days: float,
    dry_run: bool = False,
) -> Dict[str, Union[str, int, bool]]:
    """
    Delete generated audio files older than retention_days.

    Only files matching the tts_ prefix and a known audio extension are
    considered, so other files in the folder are never touched.

    Returns:
        Dict with stats: dir, exists, deleted, freed_bytes, kept, dry_run.
    """
    out = Path(output_dir).expanduser()
    result = {
        "dir": str(out),
        "exists": out.is_dir(),
        "deleted": 0,
        "freed_bytes": 0,
        "kept": 0,
        "dry_run": dry_run,
    }

    if not out.is_dir():
        logger.info("Cleanup: directory does not exist (%s); nothing to do", out)
        return result

    cutoff = time.time() - float(retention_days) * 86400.0
    logger.info(
        "Cleanup: scanning %s for tts_* audio older than %.1f days (cutoff %s)",
        out, retention_days, time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(cutoff)),
    )

    for f in sorted(out.iterdir()):
        if not f.is_file():
            continue
        if not f.name.startswith(FILE_PREFIX) or f.suffix.lower() not in AUDIO_EXTENSIONS:
            continue
        try:
            mtime = f.stat().st_mtime
        except OSError:
            continue
        if mtime >= cutoff:
            result["kept"] += 1  # type: ignore[operator]
            continue

        size = 0
        try:
            size = f.stat().st_size
        except OSError:
            pass

        if dry_run:
            logger.info("Cleanup (dry-run): would delete %s (%.1f KB)", f.name, size / 1024)
            result["deleted"] += 1  # type: ignore[operator]
            result["freed_bytes"] += size  # type: ignore[operator]
            continue

        try:
            f.unlink()
            logger.info("Cleanup: deleted %s (%.1f KB)", f.name, size / 1024)
            result["deleted"] += 1  # type: ignore[operator]
            result["freed_bytes"] += size  # type: ignore[operator]
        except OSError as exc:
            logger.error("Cleanup: failed to delete %s: %s", f.name, exc)

    logger.info(
        "Cleanup finished: %s deleted (%s freed), %s kept",
        result["deleted"], _human_bytes(int(result["freed_bytes"])), result["kept"],
    )
    return result


def _human_bytes(num: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if num < 1024 or unit == "GB":
            return f"{num:.1f} {unit}"
        num /= 1024.0
    return f"{num:.1f} GB"
