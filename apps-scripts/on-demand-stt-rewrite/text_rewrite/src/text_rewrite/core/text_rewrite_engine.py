"""
Core rewriting engine for text_rewrite package.

Handles OpenAI API interactions and text rewriting logic.
"""

import time
from typing import Optional
from openai import OpenAI

from src.text_rewrite.core.clipboard import read_clipboard, write_and_paste
from src.text_rewrite.config.text_rewrite_config import RewriteConfig
from common.logging_utils.logging_config import get_logger

logger = get_logger('text_rewrite')


class RewriteEngine:
    """Core engine for text rewriting using OpenAI API."""
    
    def __init__(self, config: RewriteConfig):
        """
        Initialize the rewriting engine.
        
        Args:
            config: Configuration object with API settings and prompt template
        """
        self.config = config
        self.client = OpenAI(api_key=config.openai_api_key)
        
        logger.debug(f"Initialized RewriteEngine with model: {config.model}, "
                    f"temperature: {config.temperature}, max_tokens: {config.max_tokens}")
    
    def rewrite_text(self, text: str) -> Optional[str]:
        """
        Rewrite text using OpenAI API.
        
        Args:
            text: Text to rewrite
            
        Returns:
            str: Rewritten text, or None if rewriting failed
        """
        logger.info(f"Starting text rewriting for {len(text)} characters")
        
        # Generate prompt
        prompt = self.config.get_prompt(text)
        logger.debug(f"Generated prompt length: {len(prompt)} characters")
        
        # Retry logic with exponential backoff
        for attempt in range(self.config.max_retries + 1):  # +1 for initial attempt
            try:
                logger.debug(f"API call attempt {attempt + 1}/{self.config.max_retries + 1}")
                
                # Make API call
                resp = self.client.chat.completions.create(
                    model=self.config.model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=self.config.temperature,
                    max_tokens=self.config.max_tokens
                )
                
                # Extract polished text
                polished_text = resp.choices[0].message.content.strip()
                
                # Log token usage
                usage = resp.usage
                if usage:
                    logger.info(f"Rewriting successful - Input: {usage.prompt_tokens} tokens, "
                              f"Output: {usage.completion_tokens} tokens, Total: {usage.total_tokens} tokens")
                
                logger.info("Text rewriting completed successfully")
                return polished_text
                
            except Exception as e:
                error_msg = str(e)
                
                if attempt < self.config.max_retries:
                    # Calculate delay with exponential backoff
                    delay = self.config.retry_delay * (self.config.retry_backoff_factor ** attempt)
                    logger.warning(f"API call failed (attempt {attempt + 1}/{self.config.max_retries + 1}): {error_msg}. "
                                 f"Retrying in {delay:.1f} seconds...")
                    time.sleep(delay)
                else:
                    # All retries exhausted
                    logger.error(f"Rewriting failed after {self.config.max_retries + 1} attempts. Last error: {error_msg}")
                    return None
        
        return None
    
    def rewrite_clipboard_text(self) -> bool:
        """
        Rewrite clipboard text and paste the result at cursor position.
        
        Returns:
            bool: True if rewriting was successful, False otherwise
        """
        logger.info("Starting clipboard text rewriting")
        
        # Get clipboard content
        clipboard_text = read_clipboard()
        if clipboard_text is None:
            return False
        
        # Rewrite the text
        rewritten_text = self.rewrite_text(clipboard_text)
        if rewritten_text is None:
            return False
        
        # Paste the rewritten text
        success = write_and_paste(rewritten_text)
        if success:
            logger.info("Successfully rewritten and pasted clipboard text")
        else:
            logger.error("Failed to paste rewritten text")
        
        return success


def rewrite_clipboard_text(config: Optional[RewriteConfig] = None) -> bool:
    """
    Convenience function to rewrite clipboard text using OpenAI API.
    
    Args:
        config: Optional configuration object. If not provided, loads from environment.
        
    Returns:
        bool: True if rewriting was successful, False otherwise
    """
    # Load configuration if not provided
    if config is None:
        logger.debug("Loading configuration from environment")
        config = RewriteConfig.load_config()
    
    # Create engine and rewrite text
    engine = RewriteEngine(config)
    return engine.rewrite_clipboard_text()
