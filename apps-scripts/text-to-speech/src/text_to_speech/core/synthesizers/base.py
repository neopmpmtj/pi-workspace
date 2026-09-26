"""
Base class for all TTS synthesizers.

Each provider implements:
  - synthesize(text, speed) -> audio bytes
  - list_voices() -> [{"id", "name", "language", "gender"}]
  - is_configured() -> (bool, reason)
"""

import os
from typing import Any, Dict, List, Tuple

from ...logging_utils import get_logger


class SynthError(Exception):
    """Raised when synthesis or provider configuration fails."""


class BaseSynthesizer:
    id: str = "base"
    label: str = "Base"
    description: str = ""
    requires_key: bool = False
    key_env: str = ""
    format: str = "mp3"

    def __init__(self, config: Dict[str, Any], logger=None):
        self.config = config or {}
        self.logger = logger or get_logger(f"synth.{self.id}")

    # ------------------------------------------------------------------
    def is_configured(self) -> Tuple[bool, str]:
        """(ok, reason) — key present when required, else always ok."""
        if not self.requires_key:
            return True, ""
        key = self.api_key
        if key:
            return True, ""
        return False, f"Missing API key: set {self.key_env} in ~/.pi/apps-scripts/text-to-speech/.env"

    @property
    def api_key(self) -> str:
        return os.environ.get(self.key_env, "").strip()

    # ------------------------------------------------------------------
    def synthesize(self, text: str, speed: float = 1.0) -> bytes:  # pragma: no cover - abstract
        raise NotImplementedError

    def list_voices(self) -> List[Dict[str, str]]:  # pragma: no cover - default empty
        return []
