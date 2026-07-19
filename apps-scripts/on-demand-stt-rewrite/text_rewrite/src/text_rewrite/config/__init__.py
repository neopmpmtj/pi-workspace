"""Configuration module for text_rewrite package."""

from src.text_rewrite.config.text_rewrite_config import RewriteConfig, PROMPT_TEMPLATES
from src.text_rewrite.config.state_manager import StateManager

__all__ = ['RewriteConfig', 'PROMPT_TEMPLATES', 'StateManager']
