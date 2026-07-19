"""
Configuration Handler for Runtime Config

This module previously handled reading and writing to runtime_config.json. Now, configuration is managed via Python dataclasses and environment variables. No runtime_config.json is used.
for the speech-to-text application dashboard.
"""

import json
from pathlib import Path
from typing import Dict, Any
from django.conf import settings


def load_runtime_config() -> Dict[str, Any]:
    """
    Load the current runtime configuration from Python dataclasses and environment variables (no runtime_config.json).
    
    Returns:
        dict: The runtime configuration data
    """
    config_path = Path(settings.RUNTIME_CONFIG_PATH)
    
    # Default configuration structure
    default_config = {
        "transcription": {
            "language": "pt",
            "model": "whisper-1"
        },
        "paste": {
            "add_timestamp": False,
            "hotkey": "auto"
        }
    }
    
    try:
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                config_data = json.load(f)

            config_data.setdefault("transcription", {})
            config_data["transcription"].setdefault("language", default_config["transcription"]["language"])
            config_data["transcription"].setdefault("model", default_config["transcription"]["model"])

            config_data.setdefault("paste", {})
            config_data["paste"].setdefault("add_timestamp", default_config["paste"]["add_timestamp"])
            config_data["paste"].setdefault("hotkey", default_config["paste"]["hotkey"])

            return config_data
        else:
            # Create default config file if it doesn't exist
            save_runtime_config(default_config)
            return default_config
    except Exception as e:
        print(f"Error loading runtime config: {e}")
        return default_config


def save_runtime_config(config_data: Dict[str, Any]) -> bool:
    """
    Save the runtime configuration to Python dataclasses and environment variables (no runtime_config.json).
    
    Args:
        config_data: The configuration data to save
        
    Returns:
        bool: True if save was successful, False otherwise
    """
    config_path = Path(settings.RUNTIME_CONFIG_PATH)
    
    try:
        # Ensure parent directory exists
        config_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(config_data, f, indent=2)
        
        print(f"Configuration saved to: {config_path}")
        return True
    except Exception as e:
        print(f"Error saving runtime config: {e}")
        return False

