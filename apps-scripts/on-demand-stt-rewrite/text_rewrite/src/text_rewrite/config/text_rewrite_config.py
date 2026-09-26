"""
Configuration module for text_rewrite package.

Handles configuration loading with priority:
1. Environment variables
2. .env file in project root
3. Default values in config file
"""

import os
from pathlib import Path
from typing import Dict, Optional, Any
from dotenv import load_dotenv
from common.logging_utils.logging_config import get_logger

# Set up logger for configuration loading
logger = get_logger('text_rewrite')

# Predefined prompt templates
PROMPT_TEMPLATES = {
    'to-llm': (
        "Convert the following text to a more LLM-friendly format. "
        "Make it suitable for an assistant coding LLM input.\n\n"
        "Text: {text}\n\n"
        "Assistant Coding Version:"
    ),
    'story': (
        "Write a short fictional story with the inputted text\n\n"
        "Text: {text}\n\n"
        "Story:"
    ),
    'fairytale': (
        "Write a fairy tale story with the inputted text as inspiration\n\n"
        "Text: {text}\n\n"
        "Fairy Tale:"
    ),
    'grammar': (
        "Polish and improve the grammar, spelling, and clarity of the following text. "
        "Keep the original meaning and tone, but make it more professional and readable.\n\n"
        "Text: {text}\n\n"
        "Polished Text:"
    ),
    'professional': (
        "Convert the following text to a more professional tone while maintaining the core message. "
        "Make it suitable for business communication.\n\n"
        "Text: {text}\n\n"
        "Professional Version:"
    ),
    'casual': (
        "Convert the following text to a more casual, friendly tone while keeping the main points. "
        "Make it sound conversational and approachable.\n\n"
        "Text: {text}\n\n"
        "Casual Version:"
    )
}


class RewriteConfig:
    """Configuration class for text_rewrite module."""
    
    def __init__(self):
        # Default configuration values
        self.model = "gpt-3.5-turbo"
        self.temperature = 0.0
        self.max_tokens = 800
        self.prompt_template = PROMPT_TEMPLATES['to-llm']  # Default to story
        self.openai_api_key = ""
        self.max_retries = 3
        self.retry_delay = 1.0
        self.retry_backoff_factor = 2.0
        self.selected_prompt_name = 'to-llm'
        self.save_state = True  # Enable/disable state saving
    
    @classmethod
    def load_config(cls, prompt_name: Optional[str] = None) -> 'RewriteConfig':
        """
        Load configuration with priority order:
        1. Environment variables
        2. .env file in project root
        3. Default values in config file
        
        Args:
            prompt_name: Name of prompt template to use (overrides env/default)
            
        Returns:
            RewriteConfig: Loaded configuration object
        """
        logger.info("Loading configuration...")
        
        config = cls()
        
        # Check if state saving is enabled via environment
        config.save_state = os.getenv('SAVE_STATE', 'true').lower() == 'true'
        
        # Load from state file if enabled and no explicit prompt provided
        if config.save_state and prompt_name is None:
            from src.text_rewrite.config.state_manager import StateManager
            state_mgr = StateManager()
            state = state_mgr.load_state()
            
            if state:
                logger.info("Loading configuration from state file")
                # Apply state values (before env vars so env vars take precedence)
                if 'prompt_name' in state and state['prompt_name'] in PROMPT_TEMPLATES:
                    prompt_name = state['prompt_name']
                    logger.debug(f"Using saved prompt: {prompt_name}")
                if 'model' in state:
                    config.model = state['model']
                if 'temperature' in state:
                    config.temperature = state['temperature']
                if 'max_tokens' in state:
                    config.max_tokens = state['max_tokens']
        
        # Step 1: Load from .env file in project root
        project_root = Path(__file__).parent.parent.parent.parent  # Go up to project root
        env_file = project_root / '.env'
        
        if env_file.exists():
            logger.info(f"Loading .env file from: {env_file}")
            # override=True: the app's own .env is the PRIMARY key source and
            # wins over anything already exported (e.g. ~/.config/openai.env).
            load_dotenv(env_file, override=True)
        else:
            logger.info("No .env file found in project root")
        
        # Step 2: Load from environment variables (with fallback to defaults)
        logger.info("Loading configuration from environment variables...")
        
        config.model = os.getenv('OPENAI_MODEL', config.model)
        logger.debug(f"Model: {config.model} (from env: {'OPENAI_MODEL' in os.environ})")
        
        config.temperature = float(os.getenv('TEMPERATURE', config.temperature))
        logger.debug(f"Temperature: {config.temperature} (from env: {'TEMPERATURE' in os.environ})")
        
        config.max_tokens = int(os.getenv('MAX_TOKENS', config.max_tokens))
        logger.debug(f"Max tokens: {config.max_tokens} (from env: {'MAX_TOKENS' in os.environ})")
        
        config.openai_api_key = os.getenv('OPENAI_API_KEY', config.openai_api_key)
        logger.debug(f"API key: {'***' if config.openai_api_key else 'NOT SET'} (from env: {'OPENAI_API_KEY' in os.environ})")
        
        config.max_retries = int(os.getenv('MAX_RETRIES', config.max_retries))
        logger.debug(f"Max retries: {config.max_retries} (from env: {'MAX_RETRIES' in os.environ})")
        
        config.retry_delay = float(os.getenv('RETRY_DELAY', config.retry_delay))
        logger.debug(f"Retry delay: {config.retry_delay} (from env: {'RETRY_DELAY' in os.environ})")
        
        config.retry_backoff_factor = float(os.getenv('RETRY_BACKOFF_FACTOR', config.retry_backoff_factor))
        logger.debug(f"Retry backoff factor: {config.retry_backoff_factor} (from env: {'RETRY_BACKOFF_FACTOR' in os.environ})")
        
        # Handle prompt template selection
        env_prompt_template = os.getenv('REWRITE_PROMPT_TEMPLATE')
        if env_prompt_template:
            config.prompt_template = env_prompt_template
            logger.info("Using custom prompt template from environment variable")
        elif prompt_name and prompt_name in PROMPT_TEMPLATES:
            config.prompt_template = PROMPT_TEMPLATES[prompt_name]
            config.selected_prompt_name = prompt_name
            logger.info(f"Using predefined prompt template: {prompt_name}")
        else:
            logger.info(f"Using default prompt template: {config.selected_prompt_name}")
        
        # Step 3: Validate required fields
        if not config.openai_api_key:
            logger.error("OPENAI_API_KEY is required but not found")
            raise ValueError("OPENAI_API_KEY is required. Set it as environment variable or in .env file.")
        
        logger.info("Configuration loaded successfully")
        return config
    
    def get_prompt(self, text: str) -> str:
        """Generate the polishing prompt using the configured template."""
        return self.prompt_template.format(text=text)
    
    def set_custom_prompt(self, prompt_template: str) -> None:
        """Set a custom prompt template."""
        self.prompt_template = prompt_template
        self.selected_prompt_name = 'custom'
        logger.info("Using custom prompt template")
    
    def get_available_prompts(self) -> Dict[str, str]:
        """Get dictionary of available prompt templates."""
        return PROMPT_TEMPLATES.copy()
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert config to dictionary for state saving."""
        return {
            'prompt_name': self.selected_prompt_name,
            'model': self.model,
            'temperature': self.temperature,
            'max_tokens': self.max_tokens
        }
