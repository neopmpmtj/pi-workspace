"""
Clipboard operations for text_rewrite package.

Uses pyautogui for cross-platform paste (consistent with speech-to-text script).
Supports X11 and Wayland with proper detection and fallbacks.
"""

import os
import time
import subprocess
from typing import Optional

import pyperclip
import pyautogui

from common.logging_utils.logging_config import get_logger

logger = get_logger('text_rewrite')


def _detect_display() -> tuple:
    """Detect the display environment.
    
    Returns:
        tuple: (session_type, has_display) where session_type is 'x11', 'wayland', or 'unknown'
    """
    session_type = os.environ.get("XDG_SESSION_TYPE", "unknown").lower()
    display = os.environ.get("DISPLAY")
    wayland_display = os.environ.get("WAYLAND_DISPLAY")
    has_display = bool(display or wayland_display)
    return session_type, has_display


def _send_notification(title: str, message: str, urgency: str = "normal") -> None:
    """Send a desktop notification using notify-send.
    
    Args:
        title: Notification title
        message: Notification body
        urgency: Notification urgency ('low', 'normal', 'critical')
    """
    try:
        subprocess.run(
            ['notify-send', '-u', urgency, title, message],
            capture_output=True,
            timeout=2
        )
    except Exception as e:
        logger.debug(f"Failed to send notification: {e}")


def read_clipboard() -> Optional[str]:
    """
    Read text from clipboard.
    
    Returns:
        str: Clipboard text content, or None if clipboard is empty/invalid
    """
    try:
        clipboard_text = pyperclip.paste()
        if not clipboard_text or not clipboard_text.strip():
            logger.warning("Clipboard is empty or contains only whitespace")
            return None
        
        logger.debug(f"Retrieved {len(clipboard_text)} characters from clipboard")
        return clipboard_text
        
    except Exception as e:
        logger.error(f"Failed to read clipboard: {e}")
        _send_notification("Text Rewrite", "Failed to read clipboard", "critical")
        return None


def write_and_paste(text: str) -> bool:
    """
    Copy text to clipboard and paste it at cursor position using pyautogui.
    
    Uses the same proven approach as the speech-to-text script:
    pyperclip → pyautogui.hotkey('ctrl', 'shift', 'v')
    
    Args:
        text: Text to copy and paste
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Detect display environment
        session_type, has_display = _detect_display()
        
        logger.debug(
            "Paste environment - session=%s, DISPLAY=%s, WAYLAND_DISPLAY=%s",
            session_type,
            bool(os.environ.get("DISPLAY")),
            bool(os.environ.get("WAYLAND_DISPLAY"))
        )
        
        if not has_display:
            logger.error(
                "No graphical display detected (DISPLAY/WAYLAND_DISPLAY missing); "
                "cannot auto-paste. Text remains in clipboard."
            )
            _send_notification(
                "Text Rewrite",
                "Done! Text is in clipboard (no display to auto-paste). Press Ctrl+V to paste.",
                "normal"
            )
            return False
        
        # Pure Wayland blocks synthetic key events from pyautogui/Xlib
        if session_type == "wayland" and not os.environ.get("DISPLAY"):
            logger.error(
                "Wayland without X11 DISPLAY — auto-paste not supported. "
                "Text remains in clipboard."
            )
            _send_notification(
                "Text Rewrite",
                "Done! Text is in clipboard (Wayland: auto-paste blocked). Press Ctrl+V to paste.",
                "normal"
            )
            return False
        
        # Copy text to clipboard
        pyperclip.copy(text)
        logger.debug("Copied rewritten text to clipboard")
        
        # Small delay to ensure clipboard is ready
        time.sleep(0.15)
        
        # Simulate paste (same hotkey as speech-to-text script)
        pyautogui.hotkey('ctrl', 'shift', 'v')
        logger.info("Successfully pasted rewritten text at cursor position")
        
        _send_notification(
            "Text Rewrite",
            "Rewritten text pasted successfully!",
            "normal"
        )
        return True
        
    except Exception as e:
        logger.error(f"Failed to paste text: {e}")
        # Text is still in clipboard, user can manually paste
        _send_notification(
            "Text Rewrite",
            "Done! Text is in clipboard but auto-paste failed. Press Ctrl+V to paste.",
            "critical"
        )
        return False


def copy_to_clipboard(text: str) -> bool:
    """
    Copy text to clipboard without pasting.
    
    Args:
        text: Text to copy
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        pyperclip.copy(text)
        logger.debug("Copied text to clipboard")
        return True
        
    except Exception as e:
        logger.error(f"Failed to copy text to clipboard: {e}")
        return False