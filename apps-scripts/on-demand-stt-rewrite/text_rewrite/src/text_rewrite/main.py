import sys
import subprocess
from src.text_rewrite.core.text_rewrite_engine import RewriteEngine
from src.text_rewrite.config.text_rewrite_config import RewriteConfig
from common.logging_utils.logging_config import get_logger

logger = get_logger('text_rewrite')


def _notify(title: str, message: str, urgency: str = "normal") -> None:
    """Send a desktop notification via notify-send."""
    try:
        subprocess.run(
            ['notify-send', '-u', urgency, title, message],
            capture_output=True,
            timeout=2
        )
    except Exception:
        pass


def main(config: RewriteConfig):
    """
    Main function to execute text rewrite operation once.
    
    This function is designed to be called by Ubuntu keyboard shortcuts.
    It reads clipboard text, rewrites it using the configured prompt, and pastes the result.
    
    Args:
        config: Configuration object with prompt settings
    """
    logger.info(f"Starting text rewrite operation with prompt: {config.selected_prompt_name}")
    _notify("Text Rewrite", f"Rewriting with '{config.selected_prompt_name}' prompt…", "low")
    
    try:
        # Create rewrite engine
        engine = RewriteEngine(config)
        
        # Execute rewrite operation
        success = engine.rewrite_clipboard_text()
        
        if success:
            logger.info(f"Text rewritten and pasted successfully (using '{config.selected_prompt_name}' prompt)")
            sys.exit(0)
        else:
            logger.error("Failed to rewrite text")
            _notify("Text Rewrite", "Rewrite failed. Check logs for details.", "critical")
            sys.exit(1)
            
    except Exception as e:
        logger.error(f"Error during rewrite operation: {e}")
        _notify("Text Rewrite", f"Error: {e}", "critical")
        sys.exit(1)


if __name__ == "__main__":
    # Load default configuration for standalone execution
    config = RewriteConfig.load_config()
    main(config)
