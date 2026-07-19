"""
Audio Recording Configuration

This module defines the configuration for audio recording functionality.
All configuration values use nested dataclasses for better IDE support and type safety.
"""

import os
from pathlib import Path
from dataclasses import dataclass


def _get_default_output_directory() -> str:
    r"""
    Get the default output directory for recordings.
    
    Uses a portable location that works across different machines:
    - Windows: %LOCALAPPDATA%\L-speech-to-text\recordings
    - Other platforms: ~/.local/share/L-speech-to-text/recordings
    
    Returns:
        str: Default output directory path
    """
    if os.name == 'nt':  # Windows
        # Use LOCALAPPDATA environment variable
        local_app_data = os.environ.get('LOCALAPPDATA')
        if local_app_data:
            base_dir = Path(local_app_data)
        else:
            # Fallback to user home if LOCALAPPDATA is not set
            base_dir = Path.home() / 'AppData' / 'Local'
    else:  # macOS, Linux, etc.
        # Use XDG standard
        base_dir = Path.home() / '.local' / 'share'
    
    return str(base_dir / 'L-speech-to-text' / 'recordings')


@dataclass
class AudioConfig:
    """Audio recording parameters."""
    sample_rate: int = 16000
    channels: int = 1
    bit_depth: int = 16
    buffer_size: int = 1024


@dataclass
class OutputConfig:
    """Output file configuration."""
    save_to_file: bool = False  # Whether to save recordings to disk
    base_filename: str = "recording"
    timestamp_format: str = "%Y%m%d_%H%M%S"
    output_directory: str = None  # Will be set to default in __post_init__
    format: str = "wav"
    
    def __post_init__(self):
        """Initialize output_directory with portable default if not provided."""
        if self.output_directory is None:
            self.output_directory = _get_default_output_directory()


@dataclass
class FeedbackConfig:
    """User feedback configuration."""
    show_status_messages: bool = True


@dataclass
class RecorderConfig:
    """Complete recorder configuration combining all config sections."""
    audio: AudioConfig = None
    output: OutputConfig = None
    feedback: FeedbackConfig = None
    
    def __post_init__(self):
        """Initialize nested configs if not provided."""
        if self.audio is None:
            self.audio = AudioConfig()
        if self.output is None:
            self.output = OutputConfig()
        if self.feedback is None:
            self.feedback = FeedbackConfig()


# Default configuration instance
config = RecorderConfig()

