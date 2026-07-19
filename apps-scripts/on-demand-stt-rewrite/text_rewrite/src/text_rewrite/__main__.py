"""
Entry point for text_rewrite package.

Allows running the package with: python -m text_rewrite
"""

import sys
import os
from pathlib import Path

# Add project root to Python path to enable imports
# This allows the package to be run as: python -m text_rewrite
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent.parent  # Go from __main__.py -> text_rewrite -> src -> project root

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.text_rewrite.cli import parse_args, load_config_from_args, list_prompts, show_config
from src.text_rewrite.main import main
from common.logging_utils.logging_config import get_logger, set_console_level


def run():
    """Main entry point for the package."""
    try:
        # Parse command line arguments
        args = parse_args()
        
        # Set up centralized logging
        logger = get_logger('text_rewrite')
        if args.verbose:
            set_console_level(logger, 'DEBUG')
        else:
            set_console_level(logger, 'INFO')
        
        # Handle list prompts request
        if args.list_prompts:
            list_prompts()
            return
        
        # Handle show config request
        if args.show_config:
            show_config()
            return
        
        # Load configuration
        config = load_config_from_args(args)
        
        # Save state if enabled
        if config.save_state:
            from src.text_rewrite.config.state_manager import StateManager
            state_mgr = StateManager()
            state_mgr.save_state(config.to_dict())
        
        # Start the main application
        main(config)
        
    except KeyboardInterrupt:
        print("\nExiting...")
        sys.exit(0)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    run()
