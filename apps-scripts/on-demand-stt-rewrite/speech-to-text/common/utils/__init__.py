"""
Utilities Package

This package provides cross-platform utilities used across the entire pipeline.
It includes path handling, file system operations, clipboard utilities, and other common utilities.

Available Functions from file_sys_utils:
- resolve_path(): Resolve relative and absolute paths with base directory support
- ensure_directory(): Create directories and parent directories as needed
- get_script_directory(): Get script directory for both regular and frozen execution
- get_project_root(): Get project root directory
- sanitize_filename(): Sanitize filenames for filesystem safety

Available Functions from paste_from_clipboard:
- paste_clipboard(): Paste content from clipboard using pyautogui

Key Features:
- Cross-platform compatibility (Windows, macOS, Linux)
- PyInstaller frozen application support
- Relative and absolute path handling
- Directory creation and validation
- Filename sanitization for filesystem safety
- Clipboard paste automation

Usage:
    from common.utils import resolve_path, ensure_directory, sanitize_filename, paste_clipboard
    
    # Resolve a relative path
    config_path = resolve_path("config/settings.json")
    
    # Ensure a directory exists
    log_dir = ensure_directory("logging/2024")
    
    # Sanitize a filename
    safe_name = sanitize_filename("My:File<Name>.mp3")
    
    # Paste from clipboard
    paste_clipboard()

Author: [Your Name]
Date: [Current Date]
Version: 1.0.0
"""

from .file_sys_utils import (
    resolve_path,
    ensure_directory,
    get_script_directory,
    get_project_root,
    sanitize_filename,
)
from .paste_from_clipboard import paste_clipboard

__all__ = [
    "resolve_path",
    "ensure_directory",
    "get_script_directory",
    "get_project_root",
    "sanitize_filename",
    "paste_clipboard",
]
