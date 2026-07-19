"""
Application Configuration

This module defines the application-level configuration, including flags
for enabling/disabling dependency checks and other application settings.
All configuration values use dataclasses for better IDE support and type safety.
"""

import os
from dataclasses import dataclass, field
from typing import List


@dataclass
class DependencyCheckFlags:
    """
    Configuration for dependency checks.
    
    Each flag controls whether a specific dependency check should be performed.
    
    Attributes:
        check_ffmpeg: Enable/disable FFmpeg check
        check_pydub: Enable/disable pydub check
        check_openai_api_key: Enable/disable OpenAI API key check
    """
    check_ffmpeg: bool = True
    check_pydub: bool = True
    check_openai_api_key: bool = True
    
    def get_enabled_checks(self) -> List[str]:
        """
        Get a list of enabled check names.
        
        Returns:
            List[str]: List of enabled check names
        """
        enabled = []
        if self.check_ffmpeg:
            enabled.append('ffmpeg')
        if self.check_pydub:
            enabled.append('pydub')
        if self.check_openai_api_key:
            enabled.append('openai_api_key')
        return enabled


@dataclass
class PasteConfig:
    """
    Configuration for clipboard paste operations.
    
    Attributes:
        add_timestamp: If True, prefix pasted content with current timestamp
    """
    add_timestamp: bool = False
    
    def __post_init__(self):
        """Load configuration from environment variables if available."""
        # Load from environment variable (priority 1)
        env_value = os.environ.get("ADD_TIMESTAMP")
        if env_value is not None:
            # Convert string to boolean (case-insensitive)
            self.add_timestamp = env_value.lower() in ("true", "1", "yes", "on")
        # Note: .env file loading would happen here if implemented (priority 2)
        # Default value from dataclass field is priority 3


@dataclass
class AppConfig:
    """Complete application configuration."""
    dependency_checks: DependencyCheckFlags = field(default_factory=DependencyCheckFlags)
    paste: PasteConfig = field(default_factory=PasteConfig)
    
    def __post_init__(self):
        """Initialize nested configs if not provided."""
        if self.dependency_checks is None:
            self.dependency_checks = DependencyCheckFlags()
        if self.paste is None:
            self.paste = PasteConfig()


# Default configuration instance
config = AppConfig()

