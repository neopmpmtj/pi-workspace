"""
Clipboard input + desktop notifications for the TTS app.
"""

import subprocess
from typing import Optional

import pyperclip

from ..logging_utils import get_logger

logger = get_logger("clipboard")


def send_notification(title: str, message: str, urgency: str = "normal") -> None:
    """Send a desktop notification (best effort; never raises)."""
    try:
        subprocess.run(
            ["notify-send", "-u", urgency, title, message],
            capture_output=True,
            timeout=2,
        )
    except Exception as exc:  # pragma: no cover
        logger.debug("Notification failed: %s", exc)


def read_clipboard() -> Optional[str]:
    """
    Read text from the clipboard.

    Returns:
        Clipboard text, or None if empty / unreadable.
    """
    try:
        text = pyperclip.paste()
        if not text or not text.strip():
            logger.warning("Clipboard is empty or contains only whitespace")
            return None
        logger.debug("Read %d characters from clipboard", len(text))
        return text
    except Exception as exc:
        logger.error("Failed to read clipboard: %s", exc)
        send_notification("Text-to-Speech", "Failed to read clipboard", "critical")
        return None
