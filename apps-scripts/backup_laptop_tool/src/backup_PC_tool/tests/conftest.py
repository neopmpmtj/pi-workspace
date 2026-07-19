"""Pytest fixtures for backup_tool tests."""

import os
import tempfile
from pathlib import Path

import pytest


@pytest.fixture
def tmp_source_dir(tmp_path: Path) -> Path:
    """Create a temporary source directory with sample files and blacklisted dirs."""
    (tmp_path / "keep").mkdir()
    (tmp_path / "keep" / "file.txt").write_text("content")
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "config").write_text("ignored")
    (tmp_path / "venv").mkdir()
    (tmp_path / "venv" / "bin").mkdir()
    (tmp_path / "venv" / "bin" / "python").write_text("")
    (tmp_path / "root_file.txt").write_text("root")
    return tmp_path


@pytest.fixture
def blacklist() -> list[str]:
    """Default blacklist matching backup_config.json."""
    return [".git", "venv", ".venv", "__pycache__", "node_modules", ".backup_PC_cache"]
