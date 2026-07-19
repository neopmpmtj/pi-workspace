"""
CLI argument parsing for text_rewrite package.
"""

import argparse
import sys
from typing import Optional

from src.text_rewrite.config.text_rewrite_config import RewriteConfig, PROMPT_TEMPLATES


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description='Rewrite clipboard text using OpenAI API and paste at cursor position.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m text_rewrite --prompt story          # Use story writing prompt
  python -m text_rewrite --prompt fairytale      # Use fairy tale prompt
  python -m text_rewrite --prompt grammar        # Use grammar polishing prompt
  python -m text_rewrite --custom-prompt "..."   # Use custom prompt
  python -m text_rewrite --list-prompts         # List available prompts
  python -m text_rewrite --show-config          # Show current configuration
        """
    )
    
    # Prompt selection group (mutually exclusive)
    prompt_group = parser.add_mutually_exclusive_group()
    
    prompt_group.add_argument(
        '--prompt',
        choices=list(PROMPT_TEMPLATES.keys()),
        help='Select a predefined prompt template'
    )
    
    prompt_group.add_argument(
        '--custom-prompt',
        type=str,
        help='Use a custom prompt template'
    )
    
    prompt_group.add_argument(
        '--list-prompts',
        action='store_true',
        help='List available prompt templates and exit'
    )
    
    prompt_group.add_argument(
        '--show-config',
        action='store_true',
        help='Show current default configuration settings and exit'
    )
    
    # Additional options
    parser.add_argument(
        '--model',
        type=str,
        help='OpenAI model to use (overrides config)'
    )
    
    parser.add_argument(
        '--temperature',
        type=float,
        help='Temperature for text generation (overrides config)'
    )
    
    parser.add_argument(
        '--max-tokens',
        type=int,
        help='Maximum tokens for response (overrides config)'
    )
    
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose logging'
    )
    
    parser.add_argument(
        '--no-save-state',
        action='store_true',
        help='Do not save current configuration as default for next run'
    )
    
    parser.add_argument(
        '--clear-state',
        action='store_true',
        help='Clear saved state and exit'
    )
    
    return parser.parse_args()


def list_prompts() -> None:
    """List available prompt templates."""
    print("Available prompt templates:")
    print("=" * 50)
    
    for name, template in PROMPT_TEMPLATES.items():
        print(f"\n{name.upper()}:")
        print(f"  {template}")
        print()


def show_config() -> None:
    """Display current default configuration settings."""
    config = RewriteConfig.load_config()
    print("Current Configuration Settings:")
    print("=" * 50)
    print(f"Model: {config.model}")
    print(f"Temperature: {config.temperature}")
    print(f"Max Tokens: {config.max_tokens}")
    print(f"Max Retries: {config.max_retries}")
    print(f"Retry Delay: {config.retry_delay}s")
    print(f"Retry Backoff Factor: {config.retry_backoff_factor}")
    print(f"Default Prompt: {config.selected_prompt_name}")
    print(f"API Key: {'Set' if config.openai_api_key else 'NOT SET'}")


def load_config_from_args(args: Optional[argparse.Namespace] = None) -> RewriteConfig:
    """
    Load configuration based on command line arguments.
    
    Args:
        args: Parsed command line arguments. If None, will parse from sys.argv.
        
    Returns:
        RewriteConfig: Loaded configuration object
    """
    if args is None:
        args = parse_args()
    
    # Handle list prompts request
    if args.list_prompts:
        list_prompts()
        sys.exit(0)
    
    # Handle show config request
    if args.show_config:
        show_config()
        sys.exit(0)
    
    # Handle clear state request
    if args.clear_state:
        from src.text_rewrite.config.state_manager import StateManager
        state_mgr = StateManager()
        if state_mgr.clear_state():
            print("State cleared successfully")
        else:
            print("No state file to clear")
        sys.exit(0)
    
    # Load base configuration
    config = RewriteConfig.load_config(prompt_name=args.prompt)
    
    # Apply custom prompt if specified
    if args.custom_prompt:
        config.set_custom_prompt(args.custom_prompt)
    
    # Override with command line arguments if provided
    if args.model:
        config.model = args.model
    
    if args.temperature is not None:
        config.temperature = args.temperature
    
    if args.max_tokens:
        config.max_tokens = args.max_tokens
    
    # Apply no-save-state flag
    if args.no_save_state:
        config.save_state = False
    
    return config


if __name__ == "__main__":
    # Test CLI parsing
    args = parse_args()
    print(f"Parsed arguments: {args}")
    
    if args.list_prompts:
        list_prompts()
    else:
        config = load_config_from_args(args)
        print(f"Loaded config with prompt: {config.selected_prompt_name}")
        print(f"Model: {config.model}")
        print(f"Temperature: {config.temperature}")
        print(f"Max tokens: {config.max_tokens}")
