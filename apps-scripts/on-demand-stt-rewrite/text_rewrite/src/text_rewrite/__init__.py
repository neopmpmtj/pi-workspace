"""
Text Rewrite Package

A modular package for rewriting and transforming text using OpenAI's API.
Supports multiple prompt templates selectable via CLI flags.
"""

__version__ = "1.0.0"
__author__ = "Text Rewrite Team"

# Import main public API
from src.text_rewrite.core.text_rewrite_engine import RewriteEngine, rewrite_clipboard_text
from src.text_rewrite.config.text_rewrite_config import RewriteConfig, PROMPT_TEMPLATES
from src.text_rewrite.cli import parse_args, load_config_from_args, list_prompts, show_config

# Public API
__all__ = [
    'RewriteEngine',
    'rewrite_clipboard_text', 
    'RewriteConfig',
    'PROMPT_TEMPLATES',
    'parse_args',
    'load_config_from_args',
    'list_prompts',
    'show_config'
]
