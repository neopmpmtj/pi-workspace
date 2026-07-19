"""Core functionality for text_rewrite package."""

from src.text_rewrite.core.text_rewrite_engine import RewriteEngine, rewrite_clipboard_text
from src.text_rewrite.core.clipboard import read_clipboard, write_and_paste

__all__ = ['RewriteEngine', 'rewrite_clipboard_text', 'read_clipboard', 'write_and_paste']
