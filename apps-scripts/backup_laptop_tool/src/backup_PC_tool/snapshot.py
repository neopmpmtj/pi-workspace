from __future__ import annotations

import os
import socket
import tarfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List, Optional

from .config import get_blacklist, get_token_file
from .log import get_logger


logger = get_logger("backup.snapshot")


@dataclass
class SnapshotResult:
    archive_path: Path
    archive_name: str
    created_at_utc: str
    root_path: Path


def _is_blacklisted_dirname(name: str, blacklist: List[str]) -> bool:
    return name in blacklist


def _build_exclude_sets(blacklist: List[str]) -> List[str]:
    # Always exclude the token file and cache folder by name.
    # Also exclude the config file ONLY if you want; here we keep it.
    auto = [
        get_token_file(),
    ]
    # Merge unique names
    merged = list(dict.fromkeys(blacklist + auto))
    return merged


def _split_blacklist_entries(blacklist: List[str]) -> tuple[set[str], list[Path]]:
    """Split blacklist into component names and absolute paths."""
    name_entries: set[str] = set()
    absolute_entries: list[Path] = []

    for raw in _build_exclude_sets(blacklist):
        entry = str(raw).strip()
        if not entry:
            continue

        p = Path(entry).expanduser()
        if p.is_absolute():
            absolute_entries.append(p.resolve())
        else:
            name_entries.add(entry)

    return name_entries, absolute_entries


def _is_within(path: Path, parent: Path) -> bool:
    return path == parent or parent in path.parents


def _pruned_walk(root: Path, blacklist: List[str]) -> Iterable[tuple[str, List[str], List[str]]]:
    """
    os.walk with in-place directory pruning.

    This is the key fix: we remove blacklisted directories BEFORE descent,
    so we never enumerate their children.
    """
    name_blacklist, absolute_blacklist = _split_blacklist_entries(blacklist)

    for dirpath, dirnames, filenames in os.walk(root):
        # prune in-place
        original = list(dirnames)
        current_dir = Path(dirpath).resolve()
        kept: list[str] = []
        for d in dirnames:
            abs_candidate = (current_dir / d).resolve()
            if d in name_blacklist:
                continue
            if any(_is_within(abs_candidate, p) for p in absolute_blacklist):
                continue
            kept.append(d)
        dirnames[:] = kept

        removed = set(original) - set(dirnames)
        for r in sorted(removed):
            logger.info(f"Skipping blacklisted directory: {Path(dirpath) / r}")

        yield dirpath, dirnames, filenames


def create_snapshot_archive(
    source_dir: Path,
    cache_dir: Optional[Path] = None,
    blacklist: Optional[List[str]] = None,
) -> SnapshotResult:
    """
    Create a .tar.gz snapshot of source_dir, excluding blacklisted dirs.

    The archive contains relative paths rooted at source_dir.
    """
    source_dir = source_dir.resolve()
    if blacklist is None:
        blacklist = get_blacklist()

    if cache_dir is None:
        cache_dir = source_dir / ".backup_PC_cache"

    cache_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    hostname = socket.gethostname()
    archive_name = f"backup_{hostname}_{ts}.tar.gz"
    archive_path = cache_dir / archive_name

    name_blacklist, absolute_blacklist = _split_blacklist_entries(blacklist)

    def should_skip_path(abs_path: Path, rel_path: Path) -> bool:
        # Skip any path whose any component matches a blacklisted name
        if any(part in name_blacklist for part in rel_path.parts):
            return True
        return any(_is_within(abs_path.resolve(), p) for p in absolute_blacklist)

    logger.info(f"Creating snapshot from: {source_dir}")
    logger.info(f"Archive path: {archive_path}")

    with tarfile.open(archive_path, "w:gz") as tf:
        for dirpath, _, filenames in _pruned_walk(source_dir, blacklist):
            dp = Path(dirpath)

            # Add directory itself (so empty dirs are preserved)
            rel_dir = dp.relative_to(source_dir)
            if rel_dir != Path(".") and not should_skip_path(dp, rel_dir):
                tf.add(dp, arcname=str(rel_dir), recursive=False)

            for fn in filenames:
                abs_file = dp / fn
                rel_file = abs_file.relative_to(source_dir)

                if should_skip_path(abs_file, rel_file):
                    continue

                # Avoid archiving the archive itself if cache is inside source_dir
                if abs_file == archive_path:
                    continue

                tf.add(abs_file, arcname=str(rel_file), recursive=False)

    return SnapshotResult(
        archive_path=archive_path,
        archive_name=archive_name,
        created_at_utc=ts,
        root_path=source_dir,
    )


def cleanup_old_cache_files(cache_dir: Path, keep_current: Path) -> None:
    """
    Delete all old backup files from cache_dir, keeping only keep_current.
    
    This prevents the cache from growing indefinitely. Only .tar.gz files
    are considered; directories are skipped.
    """
    if not cache_dir.exists():
        return
    
    # Find all .tar.gz backup files
    backup_files = [
        f for f in cache_dir.iterdir()
        if f.is_file() and f.suffixes == ['.tar', '.gz'] and f.name.endswith('.tar.gz')
    ]
    
    if len(backup_files) <= 1:
        return
    
    # Sort by modification time (newest first)
    backup_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    
    # Determine which file to keep (prefer keep_current, but fall back to newest)
    file_to_keep = keep_current if keep_current in backup_files else backup_files[0]
    
    # Delete all files except the one to keep
    deleted_count = 0
    for backup_file in backup_files:
        if backup_file != file_to_keep:
            try:
                backup_file.unlink()
                logger.info(f"Deleted old cache file: {backup_file.name}")
                deleted_count += 1
            except OSError as e:
                logger.warning(f"Failed to delete {backup_file.name}: {e}")
    
    if deleted_count > 0:
        logger.info(f"Cache cleanup: deleted {deleted_count} old backup file(s), kept {file_to_keep.name}")
