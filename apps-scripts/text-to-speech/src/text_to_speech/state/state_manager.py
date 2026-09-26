"""
State file management for text_to_speech.

The state file (.tts_state.json at the app root) is the single source of
truth shared by the CLI, the hotkey wrapper, the cleanup cron job, and the
web dashboard. Any of them may update it; the synthesis engine always reads
it fresh on each run.
"""

import copy
import json
import threading
from pathlib import Path
from typing import Any, Dict, Optional

from .. import STATE_FILE
from ..logging_utils import get_logger

logger = get_logger("state")

PROVIDER_IDS = ["edge", "openai", "cartesia", "elevenlabs"]

DEFAULT_STATE: Dict[str, Any] = {
    "provider": "edge",
    "global": {
        "speed": 1.0,
        "format": "mp3",
        "output_dir": "~/Voice",
        "retention_days": 14,
    },
    "edge": {
        "voice": "en-US-MichelleNeural",
        "rate": "+0%",
        "pitch": "+0Hz",
        "volume": "+0%",
    },
    "openai": {
        "voice": "coral",
        "model": "gpt-4o-mini-tts",
        "instructions": "",
    },
    "cartesia": {
        "voice": "0834f3df-e650-4766-a20c-5a93a43aa6e3",  # Leo
        "model": "sonic-3.6",
        "emotion": "",
    },
    "elevenlabs": {
        "voice": "pMsXgVXv3BLzUgSXRplE",  # Rachel (default voice)
        "model": "eleven_flash_v2_5",
        "stability": 0.5,
        "similarity": 0.75,
        "style": 0.0,
        "use_speaker_boost": True,
    },
}


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Merge override into a deep copy of base (dicts merged recursively)."""
    out = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


class StateManager:
    """Thread-safe reader/writer for .tts_state.json."""

    def __init__(self, path: Optional[Path] = None):
        self.path = Path(path) if path else STATE_FILE
        self._lock = threading.Lock()

    def load(self) -> Dict[str, Any]:
        """Load state, deep-merged over defaults so new fields never break."""
        with self._lock:
            if not self.path.exists():
                logger.info("State file not found; using defaults (%s)", self.path)
                return copy.deepcopy(DEFAULT_STATE)
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
                merged = _deep_merge(DEFAULT_STATE, raw)
                if merged.get("provider") not in PROVIDER_IDS:
                    logger.warning("Unknown provider %r in state; falling back to 'edge'", merged.get("provider"))
                    merged["provider"] = "edge"
                return merged
            except Exception as exc:
                logger.error("Failed to read state file %s: %s; using defaults", self.path, exc)
                return copy.deepcopy(DEFAULT_STATE)

    def save(self, state: Dict[str, Any]) -> bool:
        """Atomically write state to disk (tmp file + replace)."""
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
        """Delete the state file, returning to defaults on next load."""
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

    def provider_config(self, state: Dict[str, Any], provider_id: str) -> Dict[str, Any]:
        """Provider settings block for provider_id (ensures it exists)."""
        if provider_id not in PROVIDER_IDS:
            raise ValueError(f"Unknown provider '{provider_id}'")
        return state.setdefault(provider_id, copy.deepcopy(DEFAULT_STATE[provider_id]))
