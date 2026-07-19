"""
Clipboard paste utility for the jassist application.

Provides functionality to paste content from the clipboard using pyautogui.
"""

import os
import sys


def _default_hotkey_for_platform():
    """Return the default paste hotkey tuple for the current platform."""
    if sys.platform == "darwin":
        return ('command', 'v')
    if os.name == 'nt':
        return ('ctrl', 'v')
    return ('ctrl', 'shift', 'v')


def _parse_paste_hotkey(hotkey_value):
    """Parse runtime-configured hotkey value into a pyautogui hotkey tuple."""
    if not hotkey_value:
        return _default_hotkey_for_platform()

    normalized = str(hotkey_value).strip().lower().replace(" ", "")
    mapping = {
        "auto": _default_hotkey_for_platform(),
        "ctrl_v": ('ctrl', 'v'),
        "ctrl+v": ('ctrl', 'v'),
        "ctrl_shift_v": ('ctrl', 'shift', 'v'),
        "ctrl+shift+v": ('ctrl', 'shift', 'v'),
        "command_v": ('command', 'v'),
        "cmd_v": ('command', 'v'),
        "command+v": ('command', 'v'),
        "cmd+v": ('command', 'v'),
    }
    return mapping.get(normalized, _default_hotkey_for_platform())

def paste_clipboard():
    """
    Paste content from clipboard using pyautogui and add a trailing space.
    
    This function checks if there's content in the clipboard, uses
    pyautogui to simulate the platform-appropriate paste hotkey,
    and then adds a space to separate it from future content.
    
    If the add_timestamp config flag is enabled, the content will be
    prefixed with the current timestamp before pasting.
    
    Returns:
        bool: True if paste was successful, False otherwise
    """
    # Import here to avoid circular import issues
    import pyperclip
    import pyautogui
    from datetime import datetime
    from common.logging_utils import get_logger
    from common.config.config_app import config
    
    logger = get_logger('paste_from_clipboard')
    
    try:
        content = pyperclip.paste()
        if content:
            session_type = os.environ.get("XDG_SESSION_TYPE", "unknown").lower()
            display = os.environ.get("DISPLAY")
            wayland_display = os.environ.get("WAYLAND_DISPLAY")

            logger.debug(
                "Paste environment - session_type=%s, DISPLAY=%s, WAYLAND_DISPLAY=%s",
                session_type,
                bool(display),
                bool(wayland_display)
            )

            if os.name != 'nt':
                if not display and not wayland_display:
                    logger.error(
                        "No graphical display detected (DISPLAY/WAYLAND_DISPLAY missing); "
                        "cannot auto-paste. Text remains in clipboard."
                    )
                    return False

                # PyAutoGUI relies on X11; pure Wayland sessions usually block synthetic key events
                if session_type == "wayland" and not display:
                    logger.error(
                        "Wayland session without X11 DISPLAY detected; automatic Ctrl+V is not supported here. "
                        "Text remains in clipboard."
                    )
                    return False

            # Try to read from runtime config file if it exists
            add_timestamp = config.paste.add_timestamp
            paste_hotkey_config = "auto"
            try:
                from pathlib import Path
                import json
                runtime_config_path = Path(__file__).resolve().parent.parent.parent / "runtime_config.json"
                if runtime_config_path.exists():
                    with open(runtime_config_path, 'r') as f:
                        runtime_cfg = json.load(f)
                    add_timestamp = runtime_cfg.get("paste", {}).get("add_timestamp", add_timestamp)
                    paste_hotkey_config = runtime_cfg.get("paste", {}).get("hotkey", "auto")
                    logger.debug(f"Loaded runtime config from {runtime_config_path}")
            except Exception as e:
                logger.debug(f"Could not read runtime config, using default: {e}")
            
            # Check if timestamp should be added
            if add_timestamp:
                logger.debug("add_timestamp flag is enabled, generating timestamp")
                # Generate timestamp using datetime.now()
                timestamp = datetime.now()
                # Format as YY MM DD HH:MM:SS (2-digit year, space-separated)
                timestamp_str = timestamp.strftime("%y %m %d %H:%M:%S")
                # Prefix content with timestamp and space
                content = f"{timestamp_str} {content}"
                logger.debug(f"Timestamp prefix added: {timestamp_str}")
                # Copy the modified content back to clipboard
                pyperclip.copy(content)
                logger.debug("Modified content copied back to clipboard")
            
            # Use runtime-configurable hotkey (with platform default fallback)
            paste_hotkey = _parse_paste_hotkey(paste_hotkey_config)

            pyautogui.hotkey(*paste_hotkey)
            logger.debug(
                "Attempting to paste clipboard content using hotkey: %s (config=%s)",
                "+".join(paste_hotkey),
                paste_hotkey_config,
            )
            
            # Add a space after the pasted content for proper separation
            pyautogui.write(' ')
            logger.debug("Added trailing space after pasted content")
            
            logger.info("Clipboard content pasted successfully with trailing space")
            return True
        else:
            logger.warning("Clipboard was empty, nothing to paste")
            return False
    except Exception as e:
        logger.error(f"Error during clipboard paste operation: {e}", exc_info=True)
        return False

if __name__ == "__main__":
    result = paste_clipboard()
    print(f"Paste operation result: {result}")
