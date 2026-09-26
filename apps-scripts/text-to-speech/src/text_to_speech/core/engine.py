"""
Synthesis + persistence + playback engine.

Flow (mirrors the text_rewrite app, reversed):
    clipboard text -> synthesizer -> audio bytes -> saved file -> playback

Playback runs in a detached daemon (play_daemon.py) so the global
pause/stop/replay hotkeys can control it. Only one playback at a time.
"""

import os
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from .. import APP_ROOT
from ..logging_utils import get_logger
from .cleanup import AUDIO_EXTENSIONS, FILE_PREFIX
from .clipboard import send_notification
from .synthesizers import get_synthesizer
from .synthesizers.base import SynthError

logger = get_logger("engine")

PID_FILE = Path("/tmp/tts_playback.pid")


def resolve_output_dir(state: Dict[str, Any]) -> Path:
    """Output folder: env TTS_OUTPUT_DIR > state > ~/Voice."""
    raw = (
        os.environ.get("TTS_OUTPUT_DIR")
        or state.get("global", {}).get("output_dir")
        or "~/Voice"
    )
    return Path(raw).expanduser()


def resolve_retention_days(state: Dict[str, Any]) -> float:
    """Retention: env TTS_RETENTION_DAYS > state > 14."""
    try:
        return float(
            os.environ.get("TTS_RETENTION_DAYS")
            or state.get("global", {}).get("retention_days", 14)
        )
    except (TypeError, ValueError):
        return 14.0


def synthesize_audio(
    provider_id: str,
    text: str,
    state: Dict[str, Any],
    speed: Optional[float] = None,
) -> bytes:
    """Synthesize text with the given provider. Returns audio bytes."""
    synth = get_synthesizer(provider_id, state.get(provider_id, {}))
    ok, reason = synth.is_configured()
    if not ok:
        raise SynthError(reason)
    if speed is None:
        try:
            speed = float(state.get("global", {}).get("speed", 1.0))
        except (TypeError, ValueError):
            speed = 1.0
    return synth.synthesize(text, speed=speed)


# ----------------------------------------------------------------------
# Playback daemon management
# ----------------------------------------------------------------------
def stop_existing_playback() -> bool:
    """Stop any running playback daemon and wait for it to exit.

    Returns True if a daemon was running.
    """
    if not PID_FILE.exists():
        return False
    pid = None
    try:
        pid = int(PID_FILE.read_text().strip())
    except (ValueError, OSError):
        pass

    if pid:
        try:
            os.kill(pid, signal.SIGTERM)
            deadline = time.time() + 2.0
            while time.time() < deadline:
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.1)
        except (ProcessLookupError, PermissionError):
            pass

    # Stale pid file cleanup (daemon normally removes it itself).
    try:
        PID_FILE.unlink()
    except OSError:
        pass
    return True


def start_playback(path: Path) -> None:
    """Detach a playback daemon for the given audio file."""
    stop_existing_playback()
    daemon = APP_ROOT / "play_daemon.py"
    subprocess.Popen(
        [sys.executable, str(daemon), str(path)],
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    logger.info("Playback daemon spawned for %s", path.name)


def find_last_recording(state: Dict[str, Any]) -> Optional[Path]:
    """Newest generated audio file in the output dir, or None."""
    out_dir = resolve_output_dir(state)
    if not out_dir.is_dir():
        return None
    candidates = [
        f for f in out_dir.iterdir()
        if f.is_file()
        and f.name.startswith(FILE_PREFIX)
        and f.suffix.lower() in AUDIO_EXTENSIONS
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda f: f.stat().st_mtime)


def replay_last(state: Dict[str, Any]) -> Optional[Path]:
    """Replay the newest recording. Returns the path, or None."""
    path = find_last_recording(state)
    if path is None:
        out_dir = resolve_output_dir(state)
        send_notification(
            "Text-to-Speech",
            f"No recordings found in {out_dir} yet.",
            "normal",
        )
        logger.info("Replay requested but no recordings found in %s", out_dir)
        return None
    start_playback(path)
    return path


# ----------------------------------------------------------------------
def speak(text: str, state: Dict[str, Any]) -> Dict[str, Any]:
    """Synthesize, save to the output dir, and start playback.

    Returns:
        {"status", "provider", "path", "bytes"}
    """
    provider_id = state.get("provider", "edge")
    audio = synthesize_audio(provider_id, text, state)

    out_dir = resolve_output_dir(state)
    out_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = out_dir / f"tts_{provider_id}_{timestamp}.mp3"
    path.write_bytes(audio)
    logger.info("Audio saved to %s (%.1f KB)", path, len(audio) / 1024)

    snippet = " ".join(text.split())[:60]
    send_notification(
        "Text-to-Speech",
        f"\u25b6 {snippet}{'...' if len(text) > 60 else ''}\n"
        "Space pause \u00b7 Esc stop \u00b7 Ctrl+Alt+P replay",
        "normal",
    )

    start_playback(path)
    return {"status": "playing", "provider": provider_id, "path": str(path), "bytes": len(audio)}
