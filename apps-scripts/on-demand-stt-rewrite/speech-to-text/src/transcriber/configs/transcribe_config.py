"""
Transcription Configuration

This module defines the configuration for the OpenAI Whisper API transcription service.
All configuration values use dataclasses for better IDE support and type safety.

Note: OPENAI_API_KEY must be set as an environment variable and will be 
validated when the Transcriber class is initialized.
"""

import os
from dataclasses import dataclass
from typing import Literal


@dataclass
class TranscribeConfig:
    """
    Configuration for OpenAI Whisper API transcription.
    
    Attributes:
        model: OpenAI Whisper model to use
        timeout: Request timeout in seconds
        max_retries: Maximum number of retry attempts
        language: Language code for transcription (e.g., 'en', 'fr', 'es')
        prompt: Optional prompt to guide the transcription
        temperature: Sampling temperature (0.0 to 1.0)
        response_format: Format of the response ('text' or 'json')
    """
    model: str = "whisper-1"
    timeout: int = 30
    max_retries: int = 3
    language: str = "en"
    prompt: str = ""
    temperature: float = 0.0
    response_format: Literal["text", "json"] = "text"
    
    def __post_init__(self):
        """Load configuration from environment variables if available."""
        # Load language from environment variable (priority 1)
        env_language = os.environ.get("TRANSCRIBE_LANGUAGE")
        if env_language is not None:
            self.language = env_language
        
        # Load model from environment variable (priority 1)
        env_model = os.environ.get("TRANSCRIBE_MODEL")
        if env_model is not None:
            self.model = env_model
        
        # Note: .env file loading would happen here if implemented (priority 2)
        # Default values from dataclass fields are priority 3


# Default configuration instance
config = TranscribeConfig()

