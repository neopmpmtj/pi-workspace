"""
State file management for ExplainLike12.

The state file (.explain_state.json at the app root) holds the audience,
model and length choices. The CLI writes it; every hotkey press reads it
fresh, so an agent can switch settings on your behalf at any time.
"""

import copy
import json
import threading
from pathlib import Path
from typing import Any, Dict, Optional

from . import STATE_FILE
from .logging_utils import get_logger
from .prompts import DEFAULT_AUDIENCE, DEFAULT_LENGTH, DEFAULT_MODEL

logger = get_logger("state")

DEFAULT_STATE: Dict[str, Any] = {
    "audience": DEFAULT_AUDIENCE,
    "model": DEFAULT_MODEL,
    "length": DEFAULT_LENGTH,
}


class StateManager:
    """Thread-safe reader/writer for .explain_state.json."""

    def __init__(self, path: Optional[Path] = None):
        self.path = Path(path) if path else STATE_FILE
        self._lock = threading.Lock()

    def load(self) -> Dict[str, Any]:
        with self._lock:
            if not self.path.exists():
                logger.info("State file not found; using defaults (%s)", self.path)
                return copy.deepcopy(DEFAULT_STATE)
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
                merged = copy.deepcopy(DEFAULT_STATE)
                merged.update(raw)
                return merged
            except Exception as exc:
                logger.error("Failed to read state file %s: %s; using defaults", self.path, exc)
                return copy.deepcopy(DEFAULT_STATE)

    def save(self, state: Dict[str, Any]) -> bool:
        with self._lock:
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                tmp = self.path.with_suffix(".tmp")
                tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
                tmp.replace(self.path)
                logger.debug("State saved to %s", self.path)
                return True
            except Exception as exc:
                logger.error("Failed to save state: %s", exc)
                return False

    def clear(self) -> bool:
        with self._lock:
            try:
                if self.path.exists():
                    self.path.unlink()
                    logger.info("State cleared (%s removed)", self.path)
                    return True
                return False
            except Exception as exc:
                logger.error("Failed to clear state: %s", exc)
                return False
