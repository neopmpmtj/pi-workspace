#!/usr/bin/env python3
"""Move a file or folder into an archive, keeping its path under home.

Source ``~/.pi/agent/example.md`` and target ``~/.pi/archive`` land at
``~/.pi/archive/.pi/agent/2026-11-02T17-24-16-219_example.md``.

One timestamp is shared by every file in the run. Folder names are not
stamped. A later move merges into the existing tree and never overwrites.
Directory symlinks are moved as symlinks and are not followed. The archived
path is the path that was given, relative to home, not the symlink target.

Defaults live in archive-to-target-full-tree.config.json beside this script.
``--source`` and ``--target`` override that file. ``--list`` supplies sources
from another file with the same shape; its target field is ignored.

``--undo`` reverses the single last real run, recorded in
archive-to-target-full-tree.last.json. A later real run replaces that record.
A second ``--undo`` does nothing.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import TypedDict


CONFIG_FILENAME = "archive-to-target-full-tree.config.json"
SECTION_NAME = "archiveToTargetFullTree"
LAST_FILENAME = "archive-to-target-full-tree.last.json"
LAST_SECTION = "archiveToTargetFullTreeLast"
MAX_STAMP_SUFFIX = 10000


class ArchiveToTargetFullTreeConfig(TypedDict):
    target: str | None
    sources: list[str]


class ArchiveToTargetFullTreeLastMove(TypedDict):
    source: str
    dest: str


class ArchiveToTargetFullTreeLastRun(TypedDict):
    status: str
    stamp: str
    target: str
    moves: list[ArchiveToTargetFullTreeLastMove]
    directories: list[ArchiveToTargetFullTreeLastMove]


class ConfigError(Exception):
    def __init__(self, path: Path, reason: str) -> None:
        self.path = path
        self.reason = reason
        super().__init__(f"{path} {reason}")


class MoveError(Exception):
    pass


def normalize_path(path: Path | str) -> Path:
    """Absolute path with ``~`` expanded. Symlinks are not resolved."""
    expanded = Path(os.path.expanduser(os.fspath(path)))
    if not expanded.is_absolute():
        expanded = Path.cwd() / expanded
    return Path(os.path.normpath(os.fspath(expanded)))


def make_stamp(now: datetime) -> str:
    millisecond = now.microsecond // 1000
    return now.strftime("%Y-%m-%dT%H-%M-%S-") + f"{millisecond:03d}"


def stamped_name(stamp: str, original_name: str, suffix: int | None) -> str:
    if suffix is None:
        return f"{stamp}_{original_name}"
    return f"{stamp}-{suffix}_{original_name}"


def is_inside(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return path != parent


def read_archive_to_target_full_tree_config(path: Path) -> ArchiveToTargetFullTreeConfig:
    if not path.is_file():
        raise ConfigError(path, "config not found")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ConfigError(path, f"invalid json: {error.msg}") from error
    except OSError as error:
        raise ConfigError(path, error.strerror or "could not read config") from error
    if not isinstance(data, dict) or SECTION_NAME not in data:
        raise ConfigError(path, f"missing {SECTION_NAME}")
    section = data[SECTION_NAME]
    if not isinstance(section, dict):
        raise ConfigError(path, f"{SECTION_NAME} must be an object")
    target = section.get("target")
    if target is not None and not isinstance(target, str):
        raise ConfigError(path, "target must be a string")
    if "sources" not in section:
        sources: list[str] = []
    else:
        raw_sources = section["sources"]
        if not isinstance(raw_sources, list) or any(
            not isinstance(item, str) for item in raw_sources
        ):
            raise ConfigError(path, "sources must be a list of strings")
        sources = list(raw_sources)
    return {"target": target if isinstance(target, str) else None, "sources": sources}


def safety_problem(source: Path, target: Path, home: Path) -> str | None:
    if source == home or not is_inside(source, home):
        return "source is not under home"
    if source == target:
        return "source and target are the same path"
    if is_inside(target, source):
        return "target is inside source"
    if is_inside(source, target):
        return "source is inside target"
    return None


def file_destination(source: Path, target: Path, home: Path, stamp: str, suffix: int | None) -> Path:
    relative = source.relative_to(home)
    parent = relative.parent
    dest_dir = target if parent == Path(".") else target / parent
    return dest_dir / stamped_name(stamp, relative.name, suffix)


def directory_destination(source: Path, target: Path, home: Path) -> Path:
    relative = source.relative_to(home)
    if relative == Path("."):
        return target
    return target / relative


def claim_file_destination(
    source: Path,
    target: Path,
    home: Path,
    stamp: str,
    reserved: set[str],
) -> Path:
    suffix: int | None = None
    while True:
        candidate = file_destination(source, target, home, stamp, suffix)
        key = str(candidate)
        if key not in reserved and not os.path.lexists(key):
            reserved.add(key)
            return candidate
        suffix = 2 if suffix is None else suffix + 1
        if suffix > MAX_STAMP_SUFFIX:
            raise MoveError("no free destination name")


def is_missing(path: Path) -> bool:
    return not path.exists() and not path.is_symlink()


def is_leaf(path: Path) -> bool:
    return path.is_symlink() or not path.is_dir()


def collect_tree(source: Path) -> tuple[list[Path], list[Path]]:
    """Real directories, plus files and symlink leaves. Symlink dirs are not walked."""
    leaves: list[Path] = []
    directories: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(source, followlinks=False):
        current = Path(dirpath)
        directories.append(current)
        real_dirnames: list[str] = []
        for dirname in dirnames:
            child = current / dirname
            if child.is_symlink():
                leaves.append(child)
            else:
                real_dirnames.append(dirname)
        dirnames[:] = real_dirnames
        for filename in filenames:
            leaves.append(current / filename)
    leaves.sort(key=lambda path: path.as_posix())
    directories.sort(key=lambda path: path.as_posix())
    return leaves, directories


def contains_leaf(directory: Path, leaves: list[Path]) -> bool:
    prefix = str(directory).rstrip("/") + "/"
    return any(str(leaf).startswith(prefix) for leaf in leaves)


def ensure_real_directory(path: Path, dry_run: bool) -> None:
    if path.is_symlink() or (os.path.lexists(path) and not path.is_dir()):
        raise MoveError("destination exists and is not a directory")
    if path.is_dir():
        return
    if dry_run:
        return
    path.mkdir(parents=True, exist_ok=True)


def move_leaf(source: Path, destination: Path, dry_run: bool) -> None:
    ensure_real_directory(destination.parent, dry_run)
    if dry_run:
        return
    shutil.move(str(source), str(destination))


def remove_emptied_directories(source: Path) -> list[str]:
    if source.is_symlink() or not source.is_dir():
        return []
    problems: list[str] = []
    for dirpath, dirnames, _filenames in os.walk(source, topdown=False, followlinks=False):
        current = Path(dirpath)
        if current.is_symlink():
            continue
        dirnames[:] = [
            name for name in dirnames if not (Path(dirpath) / name).is_symlink()
        ]
        try:
            current.rmdir()
        except OSError as error:
            try:
                if any(current.iterdir()):
                    continue
            except OSError:
                pass
            problems.append(error.strerror or "could not remove empty directory")
    return problems


def reason_from(error: Exception) -> str:
    if isinstance(error, (MoveError, shutil.Error, ValueError)):
        return str(error)
    strerror = getattr(error, "strerror", None)
    return strerror or str(error)


def format_ok(source: Path, destination: Path) -> str:
    return f"[ok] {source} -> {destination}"


def format_skip(source: Path) -> str:
    return f"[ok] {source} skipped, not found"


def format_fail(source: Path | None, reason: str, destination: Path | None = None) -> str:
    if source is None:
        return f"[FAIL] {reason}"
    if destination is None:
        return f"[FAIL] {source} {reason}"
    return f"[FAIL] {source} -> {destination} {reason}"


def emit(line: str) -> None:
    print(line, flush=True)


def archive_leaf(
    source: Path,
    target: Path,
    home: Path,
    stamp: str,
    reserved: set[str],
    dry_run: bool,
    journal: ArchiveToTargetFullTreeLastLog | None = None,
) -> bool:
    destination: Path | None = None
    try:
        destination = claim_file_destination(source, target, home, stamp, reserved)
        move_leaf(source, destination, dry_run)
        if journal is not None:
            journal.record_move(source, destination)
    except (MoveError, OSError, shutil.Error, ValueError) as error:
        emit(format_fail(source, reason_from(error), destination))
        return False
    emit(format_ok(source, destination))
    return True


def archive_tree(
    source: Path,
    target: Path,
    home: Path,
    stamp: str,
    reserved: set[str],
    dry_run: bool,
    journal: ArchiveToTargetFullTreeLastLog | None = None,
) -> bool:
    try:
        leaves, directories = collect_tree(source)
    except OSError as error:
        emit(format_fail(source, error.strerror or str(error)))
        return False

    succeeded = True
    for leaf in leaves:
        if not archive_leaf(leaf, target, home, stamp, reserved, dry_run, journal):
            succeeded = False

    for directory in directories:
        if contains_leaf(directory, leaves):
            continue
        try:
            destination = directory_destination(directory, target, home)
            ensure_real_directory(destination, dry_run)
            if journal is not None:
                journal.record_directory(directory, destination)
        except (MoveError, OSError, ValueError) as error:
            emit(format_fail(directory, reason_from(error)))
            succeeded = False
            continue
        emit(format_ok(directory, destination))

    if not dry_run:
        for problem in remove_emptied_directories(source):
            emit(format_fail(source, problem))
            succeeded = False
    return succeeded


def archive_source(
    raw_source: str,
    target: Path,
    home: Path,
    stamp: str,
    reserved: set[str],
    dry_run: bool,
    explicit: bool,
    journal: ArchiveToTargetFullTreeLastLog | None = None,
) -> bool:
    if not raw_source.strip():
        emit(format_fail(None, "source is empty"))
        return False
    source = normalize_path(raw_source)
    if is_missing(source):
        if explicit:
            emit(format_fail(source, "not found"))
            return False
        emit(format_skip(source))
        return True
    problem = safety_problem(source, target, home)
    if problem:
        emit(format_fail(source, problem))
        return False
    if is_leaf(source):
        return archive_leaf(source, target, home, stamp, reserved, dry_run, journal)
    return archive_tree(source, target, home, stamp, reserved, dry_run, journal)


def write_json_atomic(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def parse_last_moves(value: object, path: Path, field: str) -> list[ArchiveToTargetFullTreeLastMove]:
    if not isinstance(value, list):
        raise ConfigError(path, f"{field} must be a list")
    moves: list[ArchiveToTargetFullTreeLastMove] = []
    for item in value:
        if not isinstance(item, dict):
            raise ConfigError(path, f"{field} entries must be objects")
        source = item.get("source")
        dest = item.get("dest")
        if not isinstance(source, str) or not isinstance(dest, str):
            raise ConfigError(path, f"{field} entries need source and dest strings")
        moves.append({"source": source, "dest": dest})
    return moves


def read_archive_to_target_full_tree_last_run(path: Path) -> ArchiveToTargetFullTreeLastRun:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ConfigError(path, f"invalid json: {error.msg}") from error
    except OSError as error:
        raise ConfigError(path, error.strerror or "could not read last run") from error
    if not isinstance(data, dict) or LAST_SECTION not in data:
        raise ConfigError(path, f"missing {LAST_SECTION}")
    section = data[LAST_SECTION]
    if not isinstance(section, dict):
        raise ConfigError(path, f"{LAST_SECTION} must be an object")
    status = section.get("status")
    stamp = section.get("stamp")
    target = section.get("target")
    if status not in ("applied", "undone") or not isinstance(stamp, str) or not isinstance(target, str):
        raise ConfigError(path, "last run is missing status, stamp, or target")
    directories = section.get("directories", [])
    return {
        "status": status,
        "stamp": stamp,
        "target": target,
        "moves": parse_last_moves(section.get("moves"), path, "moves"),
        "directories": parse_last_moves(directories, path, "directories"),
    }


class ArchiveToTargetFullTreeLastLog:
    """One archive run. Writing replaces any previous last-run file."""

    def __init__(self, path: Path, stamp: str, target: Path) -> None:
        self.path = path
        self.stamp = stamp
        self.target = str(target)
        self.moves: list[ArchiveToTargetFullTreeLastMove] = []
        self.directories: list[ArchiveToTargetFullTreeLastMove] = []

    def record_move(self, source: Path, dest: Path) -> None:
        self.moves.append({"source": str(source), "dest": str(dest)})
        self.write("applied")

    def record_directory(self, source: Path, dest: Path) -> None:
        self.directories.append({"source": str(source), "dest": str(dest)})
        self.write("applied")

    def write(self, status: str) -> None:
        payload = {
            LAST_SECTION: {
                "status": status,
                "stamp": self.stamp,
                "target": self.target,
                "moves": self.moves,
                "directories": self.directories,
            }
        }
        write_json_atomic(self.path, payload)


def remove_empty_parents(start: Path, target: Path) -> None:
    current = start
    while is_inside(current, target):
        if current.is_symlink() or not current.is_dir():
            return
        try:
            if any(current.iterdir()):
                return
            current.rmdir()
        except OSError:
            return
        current = current.parent


def undo_recorded_file(item: ArchiveToTargetFullTreeLastMove, target: Path, dry_run: bool) -> bool:
    source = Path(item["source"])
    dest = Path(item["dest"])
    dest_exists = os.path.lexists(dest)
    source_exists = os.path.lexists(source)
    if not dest_exists and source_exists:
        emit(f"[ok] {source} already restored")
        return True
    if dest_exists and source_exists:
        emit(format_fail(dest, "both exist", source))
        return False
    if not dest_exists:
        emit(format_fail(dest, "not found", source))
        return False
    if dry_run:
        emit(format_ok(dest, source))
        return True
    try:
        ensure_real_directory(source.parent, dry_run=False)
        shutil.move(str(dest), str(source))
        remove_empty_parents(dest.parent, target)
    except (MoveError, OSError, shutil.Error) as error:
        emit(format_fail(dest, reason_from(error), source))
        return False
    emit(format_ok(dest, source))
    return True


def undo_recorded_directory(item: ArchiveToTargetFullTreeLastMove, target: Path, dry_run: bool) -> bool:
    source = Path(item["source"])
    dest = Path(item["dest"])
    dest_exists = os.path.lexists(dest)
    source_exists = os.path.lexists(source)
    if source_exists and (source.is_symlink() or not source.is_dir()):
        emit(format_fail(dest, "both exist", source))
        return False
    if dest_exists and (dest.is_symlink() or not dest.is_dir()):
        emit(format_fail(dest, "not a directory", source))
        return False
    if not source_exists and not dest_exists:
        emit(format_fail(dest, "not found", source))
        return False
    if not source_exists and dest_exists:
        if dry_run:
            emit(format_ok(dest, source))
            return True
        try:
            ensure_real_directory(source, dry_run=False)
            remove_empty_parents(dest, target)
        except (MoveError, OSError) as error:
            emit(format_fail(dest, reason_from(error), source))
            return False
        emit(format_ok(dest, source))
        return True
    if dest_exists and is_inside(dest, target) and not dry_run:
        remove_empty_parents(dest, target)
    emit(f"[ok] {source} already restored")
    return True


def undo_archive_to_target_full_tree(path: Path, dry_run: bool) -> int:
    if not path.is_file():
        emit("[ok] nothing to undo")
        return 0
    try:
        record = read_archive_to_target_full_tree_last_run(path)
    except ConfigError as error:
        emit(format_fail(error.path, error.reason))
        return 1
    if record["status"] == "undone":
        emit("[ok] nothing to undo")
        return 0
    if not record["moves"] and not record["directories"]:
        if not dry_run:
            record["status"] = "undone"
            write_json_atomic(path, {LAST_SECTION: record})
        emit("[ok] nothing to undo")
        return 0

    target = normalize_path(record["target"])
    succeeded = True
    for item in reversed(record["moves"]):
        if not undo_recorded_file(item, target, dry_run):
            succeeded = False
    directories = sorted(
        record["directories"],
        key=lambda item: len(Path(item["dest"]).parts),
        reverse=True,
    )
    for item in directories:
        if not undo_recorded_directory(item, target, dry_run):
            succeeded = False
    if succeeded and not dry_run:
        record["status"] = "undone"
        write_json_atomic(path, {LAST_SECTION: record})
    return 0 if succeeded else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="archive_to_target_full_tree.py",
        description=(
            "Move a file or folder under a target archive, rebuilding the "
            "path from home and prefixing every filename with one timestamp."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  archive_to_target_full_tree.py --source ~/proj/agent/example.md --target ~/archive
  archive_to_target_full_tree.py --list sources.json --target ~/archive
  archive_to_target_full_tree.py --dry-run
  archive_to_target_full_tree.py --undo
        """.strip(),
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=None,
        help=f"config file (default: {CONFIG_FILENAME} beside this script)",
    )
    parser.add_argument(
        "--list",
        type=Path,
        dest="list_file",
        default=None,
        help="JSON file of sources to move; its target field is ignored",
    )
    parser.add_argument(
        "--source",
        action="append",
        default=None,
        help="file or folder to move; replaces the config or list sources",
    )
    parser.add_argument(
        "--target",
        type=Path,
        default=None,
        help="archive folder; overrides the config target",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print planned moves and do not change anything",
    )
    parser.add_argument(
        "--undo",
        action="store_true",
        help="move the last archive run back; a second run does nothing",
    )
    return parser


def resolve_job(
    args: argparse.Namespace,
    script_dir: Path,
) -> tuple[Path, list[tuple[str, bool]]]:
    """Return the target and ``(source, explicit)`` pairs.

    ``--source`` replaces every other source list. ``--list`` otherwise
    replaces the config sources. Target comes from ``--target`` or, when
    that is omitted, from ``--config`` / the default config.
    """
    explicit = args.source is not None
    config_path = args.config if args.config is not None else script_dir / CONFIG_FILENAME
    need_config = (
        args.config is not None
        or args.target is None
        or (not explicit and args.list_file is None)
    )
    config: ArchiveToTargetFullTreeConfig = {"target": None, "sources": []}
    if need_config:
        config = read_archive_to_target_full_tree_config(config_path)

    if explicit:
        sources = [(source, True) for source in args.source]
    elif args.list_file is not None:
        listed = read_archive_to_target_full_tree_config(args.list_file)
        sources = [(source, False) for source in listed["sources"]]
    else:
        sources = [(source, False) for source in config["sources"]]

    raw_target = args.target if args.target is not None else config["target"]
    if raw_target is None or not str(raw_target).strip():
        raise ConfigError(
            config_path if args.target is None else normalize_path(args.target),
            "target is not set",
        )
    return normalize_path(raw_target), sources


def run_archive_to_target_full_tree(
    argv: list[str] | None = None,
    home: Path | None = None,
    now: datetime | None = None,
    script_dir: Path | None = None,
) -> int:
    args = build_parser().parse_args(argv)
    home = normalize_path(home if home is not None else Path.home())
    script_dir = script_dir or Path(__file__).resolve().parent
    if args.undo:
        if args.source is not None or args.list_file is not None:
            emit(format_fail(None, "--undo cannot be combined with --source or --list"))
            return 1
        return undo_archive_to_target_full_tree(script_dir / LAST_FILENAME, args.dry_run)
    stamp = make_stamp(now if now is not None else datetime.now())
    try:
        target, sources = resolve_job(args, script_dir)
    except ConfigError as error:
        emit(format_fail(error.path, error.reason))
        return 1
    journal = None if args.dry_run else ArchiveToTargetFullTreeLastLog(
        script_dir / LAST_FILENAME,
        stamp,
        target,
    )
    reserved: set[str] = set()
    succeeded = True
    for raw_source, explicit in sources:
        if not archive_source(
            raw_source,
            target,
            home,
            stamp,
            reserved,
            args.dry_run,
            explicit,
            journal,
        ):
            succeeded = False
    return 0 if succeeded else 1


def main() -> int:
    return run_archive_to_target_full_tree()


if __name__ == "__main__":
    sys.exit(main())
