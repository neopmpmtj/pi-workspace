from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_ROOT = SCRIPT_DIR.parent
ENTRYPOINT = SCRIPT_DIR / "save_youtube_transcript.py"


def skill_python_executable(skill_root: Path) -> str:
    if os.name == "nt":
        candidate = skill_root / ".venv" / "Scripts" / "python.exe"
    else:
        candidate = skill_root / ".venv" / "bin" / "python"
    if candidate.is_file():
        return str(candidate)
    return sys.executable


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the bundled save_youtube_transcript.py entry point (skill folder)."
    )
    parser.add_argument(
        "url",
        nargs="?",
        help="YouTube watch URL. Uses DEFAULT_VIDEO_URL if omitted.",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Set YOUTUBE_TRANSCRIPT_HEADLESS=1.",
    )
    parser.add_argument(
        "--format",
        choices=["text", "json", "both"],
        default="text",
        help="Output format: text, json, or both (default: text)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    env = os.environ.copy()
    if args.headless:
        env["YOUTUBE_TRANSCRIPT_HEADLESS"] = "1"

    py = skill_python_executable(SKILL_ROOT)
    command = [py, str(ENTRYPOINT)]
    if args.url:
        command.append(args.url)
    command.extend(["--format", args.format])

    result = subprocess.run(command, cwd=SKILL_ROOT, env=env, check=False)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
