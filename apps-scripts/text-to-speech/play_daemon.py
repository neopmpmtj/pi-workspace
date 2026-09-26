#!/usr/bin/env python3
"""
Playback daemon for text-to-speech.

Plays one audio file in the background and answers control signals:

  SIGUSR1   pause / resume (freezes the player with SIGSTOP / SIGCONT)
  SIGTERM   stop playback and exit
  SIGINT    same as SIGTERM

While playback is running it also ENABLES the global pause/stop GNOME
shortcuts (Space and Escape, slots custom9/custom10) so the keys work from
any window, and DISABLES them again on exit — this keeps Space/Escape
completely normal for typing whenever nothing is playing.

Design notes:
  - Signal handlers only SET FLAGS; the main loop polls the player child
    and performs the real work. No blocking work inside handlers.
  - Cleanup is ownership-checked: this daemon only removes the pid file /
    releases the hotkeys if the pid file still contains ITS pid, so a
    slow-dying old daemon can never clobber a newer one.
"""

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent
SRC = APP_ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from text_to_speech.core.clipboard import send_notification  # noqa: E402
from text_to_speech.core.player import player_command  # noqa: E402
from text_to_speech.logging_utils import get_logger  # noqa: E402

logger = get_logger("player")

PID_FILE = Path("/tmp/tts_playback.pid")

SCHEMA = "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding"
PAUSE_SLOT = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom9/"
STOP_SLOT = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom10/"

# Signal handler state (handlers only set these flags)
stop_requested = False
pause_toggle_requested = False


def _handle_sigterm(signum, frame):
    global stop_requested
    stop_requested = True


def _handle_sigusr1(signum, frame):
    global pause_toggle_requested
    pause_toggle_requested = True


# ----------------------------------------------------------------------
def _gset(slot: str, key: str, value: str) -> None:
    try:
        subprocess.run(
            ["gsettings", "set", f"{SCHEMA}:{slot}", key, value],
            capture_output=True,
            timeout=5,
        )
    except Exception as exc:  # pragma: no cover
        logger.warning("gsettings %s failed: %s", key, exc)


def enable_controls() -> None:
    """Grab Space (pause) and Escape (stop) globally while playing."""
    _gset(PAUSE_SLOT, "binding", "space")
    _gset(STOP_SLOT, "binding", "Escape")


def disable_controls() -> None:
    """Release the global Space/Escape bindings when playback ends."""
    _gset(PAUSE_SLOT, "binding", "")
    _gset(STOP_SLOT, "binding", "")


def owns_pidfile() -> bool:
    """True if the pid file still belongs to this process."""
    try:
        return PID_FILE.exists() and int(PID_FILE.read_text().strip()) == os.getpid()
    except (ValueError, OSError):
        return False


def cleanup() -> None:
    """Release hotkeys + pid file, but only if they still belong to us."""
    if owns_pidfile():
        disable_controls()
        try:
            PID_FILE.unlink()
        except OSError:
            pass
    # If another daemon took over, leave its pid file and bindings alone.


# ----------------------------------------------------------------------
def kill_child(pid) -> None:
    """Stop the player child quickly: CONT (if paused) -> TERM -> KILL."""
    try:
        os.kill(pid, signal.SIGCONT)
    except (ProcessLookupError, PermissionError):
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return
    deadline = time.time() + 0.5
    while time.time() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.05)
    try:
        os.kill(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def stop_and_exit(pid) -> None:
    """Stop the child, clean up, notify, and exit."""
    global stop_requested
    logger.info("Stopping playback")
    if pid is not None:
        kill_child(pid)
    cleanup()
    send_notification("Text-to-Speech", "\u23f9 Playback stopped", "low")
    stop_requested = False
    sys.exit(0)


# ----------------------------------------------------------------------
def main() -> int:
    global pause_toggle_requested, stop_requested

    if len(sys.argv) < 2:
        logger.error("Usage: play_daemon.py <audio-file>")
        return 2

    path = Path(sys.argv[1])
    if not path.exists():
        logger.error("Audio file not found: %s", path)
        send_notification("Text-to-Speech", f"Audio file not found: {path.name}", "critical")
        return 1

    cmd = player_command(path)
    if not cmd:
        logger.error("No usable audio player available")
        send_notification("Text-to-Speech", "No audio player available (need ffplay/aplay)", "critical")
        return 1

    # Only one playback at a time: if an old daemon is alive, stop it and
    # wait for it to fully exit before taking over its pid file/bindings.
    if PID_FILE.exists():
        try:
            old_pid = int(PID_FILE.read_text().strip())
            if old_pid != os.getpid():
                try:
                    os.kill(old_pid, signal.SIGTERM)
                    deadline = time.time() + 3.0
                    while time.time() < deadline:
                        try:
                            os.kill(old_pid, 0)
                        except ProcessLookupError:
                            break
                        time.sleep(0.1)
                except (ProcessLookupError, PermissionError):
                    pass
        except (ValueError, OSError):
            pass

    PID_FILE.write_text(str(os.getpid()))

    signal.signal(signal.SIGUSR1, _handle_sigusr1)
    signal.signal(signal.SIGTERM, _handle_sigterm)
    signal.signal(signal.SIGINT, _handle_sigterm)

    child = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    enable_controls()
    logger.info("Playback daemon started (pid %d) for %s", os.getpid(), path.name)
    send_notification(
        "Text-to-Speech",
        f"\u25b6 Playing: {path.name}\nSpace pause \u00b7 Esc stop \u00b7 Ctrl+Alt+P replay",
        "low",
    )

    paused = False
    try:
        while True:
            if stop_requested:
                stop_and_exit(child.pid)
                break  # unreachable (sys.exit), kept for clarity

            if pause_toggle_requested:
                pause_toggle_requested = False
                if child.poll() is None:
                    if not paused:
                        try:
                            os.kill(child.pid, signal.SIGSTOP)
                            paused = True
                            logger.info("Playback paused")
                            send_notification(
                                "Text-to-Speech",
                                "\u23f8 Paused \u2014 Space to resume, Esc to stop",
                                "low",
                            )
                        except ProcessLookupError:
                            break
                    else:
                        try:
                            os.kill(child.pid, signal.SIGCONT)
                            paused = False
                            logger.info("Playback resumed")
                            send_notification("Text-to-Speech", "\u25b6 Resumed", "low")
                        except ProcessLookupError:
                            break

            if child.poll() is not None:
                break

            time.sleep(0.05)
    except Exception as exc:
        logger.error("Playback loop error: %s", exc)
    finally:
        # Child may still be alive if we exited the loop abnormally.
        if child.poll() is None:
            kill_child(child.pid)
        cleanup()

    logger.info("Playback finished")
    return 0


if __name__ == "__main__":
    sys.exit(main())
