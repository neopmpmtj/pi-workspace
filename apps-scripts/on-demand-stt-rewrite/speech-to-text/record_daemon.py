#!/usr/bin/env python3
"""
Background recorder daemon for recording audio (hotkey detection removed for Ubuntu-only version).

- On start: begin recording immediately.
- On SIGTERM/SIGINT: stop recording, transcribe, copy to clipboard and paste
  into the active window, then exit.

Used together with toggle_speech.sh and a GNOME keyboard shortcut.
"""

import os
import sys
import time
import signal
from pathlib import Path

# ---------- Setup paths so we can import from src/ ----------
ROOT_DIR = Path(__file__).resolve().parent
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

# ---------- Imports from your existing app ----------
from common.logging_utils import get_logger                    # type: ignore
from recorder.record import Record                             # type: ignore
from transcriber.transcribe import Transcriber                 # type: ignore
from common.utils.paste_from_clipboard import paste_clipboard  # type: ignore
import pyperclip                                               # type: ignore

PID_FILE = Path("/tmp/u_speech_record.pid")
MIN_DURATION = 1.25  # seconds; below this we discard


running = True


def handle_signal(signum, frame):
    """Stop the main loop when we get SIGTERM or SIGINT."""
    global running
    running = False


def main() -> None:
    logger = get_logger("record_daemon")
    logger.info("record_daemon starting")

    # Write PID file so toggle script knows we're running
   # try:
    #    PID_FILE.write_text(str(os.getpid()))
   # except Exception as e:
       # logger.error(f"Failed to write PID file {PID_FILE}: {e}")

    # Prepare signal handlers
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    # Initialize components
    try:
        recorder = Record()
        transcriber = Transcriber()
    except Exception as e:
        logger.error(f"Failed to initialize recorder/transcriber: {e}")
        if PID_FILE.exists():
            PID_FILE.unlink()
        return

    # Start recording
    if not recorder.start():
        logger.error("Recorder failed to start")
        if PID_FILE.exists():
            PID_FILE.unlink()
        return

    print("[L-SPEECH] Recording... Press your toggle shortcut again to stop.")
    logger.info("Recording started")

    # Main loop – just wait until we get a signal
    try:
        while running:
            time.sleep(0.1)
    finally:
        # We get here when toggle script sends SIGTERM
        logger.info("Stopping recorder...")
        recorder.stop()

        duration = recorder.get_duration()
        logger.info(f"Recording duration: {duration:.2f} seconds")

        if duration < MIN_DURATION:
            logger.info(
                f"Recording too short ({duration:.2f}s < {MIN_DURATION}s); discarding."
            )
            recorder.discard()
            if PID_FILE.exists():
                PID_FILE.unlink()
            return

        # Get audio bytes and transcribe
        audio_bytes = recorder._get_audio_bytes()
        if not audio_bytes:
            logger.error("No audio data available after recording")
            recorder.discard()
            if PID_FILE.exists():
                PID_FILE.unlink()
            return

        try:
            text = transcriber.transcribe(audio_bytes)
        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            recorder.discard()
            if PID_FILE.exists():
                PID_FILE.unlink()
            return

        if not text:
            logger.warning("Transcription returned empty text")
            recorder.discard()
            if PID_FILE.exists():
                PID_FILE.unlink()
            return

        logger.info(f"Transcription result: {text!r}")

        # Copy to clipboard and try to paste
        try:
            pyperclip.copy(text)
            pasted = paste_clipboard()
            if pasted:
                print("[L-SPEECH] Transcription pasted at cursor.")
                logger.info("Transcription pasted successfully.")
            else:
                print("[L-SPEECH] Could not paste automatically; text is in clipboard.")
                logger.warning("paste_clipboard() returned False.")
        except Exception as e:
            print("[L-SPEECH] Failed to paste, but text is in clipboard.")
            logger.error(f"Error while copying/pasting transcription: {e}")

        recorder.discard()

        # Clean up PID file
        if PID_FILE.exists():
            PID_FILE.unlink()

        logger.info("record_daemon finished")


if __name__ == "__main__":
    main()
