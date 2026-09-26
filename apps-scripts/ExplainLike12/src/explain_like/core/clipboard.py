"""
Clipboard operations for ExplainLike12.

Reads the source text from the clipboard and pastes the explanation back
at the cursor. Paste logic is the same proven X11/Wayland-aware approach
as the text_rewrite app (pyperclip + pyautogui on X11; wl-copy + ydotool
on Wayland).
"""

import os
import shutil
import subprocess
import time
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


def _detect_display():
    session_type = os.environ.get("XDG_SESSION_TYPE", "unknown").lower()
    has_display = bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))
    return session_type, has_display


def read_clipboard() -> Optional[str]:
    """Read text from the clipboard, or None if empty/unreadable."""
    try:
        text = pyperclip.paste()
        if not text or not text.strip():
            logger.warning("Clipboard is empty or contains only whitespace")
            return None
        logger.debug("Read %d characters from clipboard", len(text))
        return text
    except Exception as exc:
        logger.error("Failed to read clipboard: %s", exc)
        send_notification("ExplainLike12", "Failed to read clipboard", "critical")
        return None


def _paste_on_wayland(text: str) -> bool:
    """Wayland: wl-copy to the native clipboard + ydotool Ctrl+Shift+V."""
    wl_copy = shutil.which("wl-copy")
    if wl_copy:
        try:
            subprocess.run(
                [wl_copy],
                input=text,
                text=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                check=True,
            )
        except Exception as exc:
            logger.warning("wl-copy failed (%s); falling back to X11 clipboard", exc)

    ydotool = shutil.which("ydotool")
    if not ydotool:
        logger.error("ydotool not found; cannot auto-paste on Wayland")
        return False
    try:
        subprocess.run(
            [ydotool, "key", "ctrl+shift+v"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=True,
        )
    except Exception as exc:
        logger.error("ydotool ctrl+shift+v failed: %s", exc)
        return False
    return True


def write_and_paste(text: str) -> bool:
    """
    Copy text to the clipboard and paste it at the cursor position.

    Returns True on success. If auto-paste fails, the text remains in the
    clipboard for manual Ctrl+V.
    """
    try:
        session_type, has_display = _detect_display()
        is_wayland = session_type == "wayland"

        if not has_display:
            pyperclip.copy(text)
            send_notification(
                "ExplainLike12",
                "Explanation ready in clipboard (no display to auto-paste). Press Ctrl+V.",
                "normal",
            )
            return False

        pyperclip.copy(text)
        time.sleep(0.15)

        if is_wayland:
            if not _paste_on_wayland(text):
                return False
        else:
            import pyautogui  # lazy import: fails at import time under Wayland

            pyautogui.hotkey("ctrl", "shift", "v")

        logger.info("Explanation pasted at cursor")
        return True

    except Exception as exc:
        logger.error("Failed to paste: %s", exc)
        send_notification(
            "ExplainLike12",
            "Explanation ready in clipboard but auto-paste failed. Press Ctrl+V to paste.",
            "critical",
        )
        return False
