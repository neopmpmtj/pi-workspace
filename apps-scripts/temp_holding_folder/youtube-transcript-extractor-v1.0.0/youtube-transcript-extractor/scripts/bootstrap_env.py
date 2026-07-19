"""
Create a local virtual environment for this skill and install dependencies.

From the skill root directory (where `requirements.txt` lives):

  python3 scripts/bootstrap_env.py

Requires network access for pip and Playwright browser download.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def _skill_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _venv_python(skill_root: Path) -> Path:
    if os.name == "nt":
        return skill_root / ".venv" / "Scripts" / "python.exe"
    return skill_root / ".venv" / "bin" / "python"


def main() -> int:
    skill_root = _skill_root()
    req = skill_root / "requirements.txt"
    req_test = skill_root / "requirements-test.txt"
    if not req.is_file():
        print(f"Missing {req}", file=sys.stderr)
        return 1

    venv_dir = skill_root / ".venv"
    if not venv_dir.is_dir():
        r = subprocess.run(
            [sys.executable, "-m", "venv", str(venv_dir)],
            cwd=skill_root,
            check=False,
        )
        if r.returncode != 0:
            return r.returncode

    py = _venv_python(skill_root)
    if not py.is_file():
        print(f"Expected venv python at {py}", file=sys.stderr)
        return 1

    pip_install = [
        str(py),
        "-m",
        "pip",
        "install",
        "--upgrade",
        "pip",
        "-r",
        str(req),
    ]
    r = subprocess.run(pip_install, cwd=skill_root, check=False)
    if r.returncode != 0:
        return r.returncode

    if req_test.is_file():
        r = subprocess.run(
            [str(py), "-m", "pip", "install", "-r", str(req_test)],
            cwd=skill_root,
            check=False,
        )
        if r.returncode != 0:
            return r.returncode

    r = subprocess.run(
        [str(py), "-m", "playwright", "install", "chromium"],
        cwd=skill_root,
        check=False,
    )
    return r.returncode


if __name__ == "__main__":
    raise SystemExit(main())
