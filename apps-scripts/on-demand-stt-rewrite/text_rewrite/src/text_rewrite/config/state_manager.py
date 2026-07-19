"""
State management for text_rewrite package.
Handles saving and loading user's last configuration choices.
"""
import json
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime
from common.logging_utils.logging_config import get_logger

logger = get_logger('text_rewrite')

class StateManager:
    """Manages persistent state for user configuration choices."""
    
    def __init__(self, state_file_path: Optional[Path] = None):
        """Initialize state manager with state file path."""
        if state_file_path is None:
            # Default to project root
            self.state_file = Path(__file__).parent.parent.parent.parent / '.text_rewrite_state.json'
        else:
            self.state_file = Path(state_file_path)
    
    def load_state(self) -> Optional[Dict[str, Any]]:
        """Load state from JSON file."""
        if not self.state_file.exists():
            logger.debug("No state file found")
            return None
        
        try:
            with open(self.state_file, 'r', encoding='utf-8') as f:
                state = json.load(f)
            logger.info(f"Loaded state from: {self.state_file}")
            return state
        except Exception as e:
            logger.warning(f"Failed to load state file: {e}")
            return None
    
    def save_state(self, config_dict: Dict[str, Any]) -> bool:
        """Save current configuration to state file."""
        try:
            state = {
                **config_dict,
                "last_updated": datetime.now().isoformat()
            }
            with open(self.state_file, 'w', encoding='utf-8') as f:
                json.dump(state, f, indent=2)
            logger.info(f"Saved state to: {self.state_file}")
            return True
        except Exception as e:
            logger.error(f"Failed to save state file: {e}")
            return False
    
    def clear_state(self) -> bool:
        """Delete state file."""
        try:
            if self.state_file.exists():
                self.state_file.unlink()
                logger.info("State file cleared")
                return True
            return False
        except Exception as e:
            logger.error(f"Failed to clear state file: {e}")
            return False
