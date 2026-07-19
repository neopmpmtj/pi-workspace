from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parent.parent
WRAPPER = SKILL_ROOT / "scripts" / "save_youtube_transcript.py"
IMPLEMENTATION = SKILL_ROOT / "scripts" / "youtube_transcript_browser.py"
TESTS = SKILL_ROOT / "tests"


def skill_python_executable(skill_root: Path) -> str:
    if os.name == "nt":
        candidate = skill_root / ".venv" / "Scripts" / "python.exe"
    else:
        candidate = skill_root / ".venv" / "bin" / "python"
    if candidate.is_file():
        return str(candidate)
    return sys.executable


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def main() -> int:
    wrapper_text = WRAPPER.read_text(encoding="utf-8")
    implementation_text = IMPLEMENTATION.read_text(encoding="utf-8")

    require("from youtube_transcript_browser import *" in wrapper_text, "Wrapper must re-export implementation symbols.")
    require("from youtube_transcript_browser import main" in wrapper_text, "Wrapper must import main from implementation.")
    require("main()" in wrapper_text, "Wrapper must call main when executed.")

    for symbol in (
        "def main()",
        "def extract_ytdlp_caption_segments",
        "def extract_caption_track_segments_from_url",
        "def extract_transcript_segments",
        "def write_transcript",
    ):
        require(symbol in implementation_text, f"Implementation is missing {symbol}.")

    require("_SKILL_ROOT" in implementation_text, "Bundled implementation should define skill-root output path.")
    conftest = TESTS / "conftest.py"
    require(conftest.is_file(), f"Missing {conftest}.")

    py = skill_python_executable(SKILL_ROOT)
    result = subprocess.run(
        [py, "-m", "pytest", str(TESTS)],
        cwd=SKILL_ROOT,
        check=False,
    )
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
