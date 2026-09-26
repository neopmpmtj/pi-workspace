"""
Audio playback on the local machine.

Provides:
  - player_command(path): the shell command list for playing a file
  - play(path): blocking playback (used for one-shot/scripted playback)

Interactive playback (pause/stop/replay) is handled by play_daemon.py,
which spawns the player as a child process so it can be paused (SIGSTOP)
and stopped (SIGTERM) from the global hotkeys.
"""

import shutil
import subprocess
from pathlib import Path

from ..logging_utils import get_logger

logger = get_logger("player")


class PlaybackError(Exception):
    """Raised when no usable audio player is available."""


def player_command(path) -> list:
    """Return the command list to play an audio file, or None if no player.

    Preference: wav -> aplay then ffplay; anything else -> ffplay (then mpv
    if it is ever installed).
    """
    p = Path(path)
    if p.suffix.lower() == ".wav" and shutil.which("aplay"):
        return ["aplay", "-q", str(p)]
    if shutil.which("ffplay"):
        return ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", str(p)]
    if shutil.which("mpv"):
        return ["mpv", "--no-video", "--really-quiet", str(p)]
    if p.suffix.lower() == ".wav" and shutil.which("aplay"):
        return ["aplay", "-q", str(p)]
    return None


def play(path, block: bool = True) -> bool:
    """Play an audio file with the first available system player.

    Returns:
        True if a player ran and exited with code 0.
    """
    p = Path(path)
    if not p.exists():
        raise PlaybackError(f"Audio file not found: {p}")

    cmd = player_command(p)
    if not cmd:
        raise PlaybackError("No usable audio player found (tried aplay/ffplay)")

    logger.info("Playing '%s' with %s", p.name, cmd[0])
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=7200,
        )
        return proc.returncode == 0
    except subprocess.TimeoutExpired:
        logger.error("Playback timed out (%s)", cmd[0])
        return False
    except Exception as exc:
        logger.warning("Player %s failed: %s", cmd[0], exc)
        return False
