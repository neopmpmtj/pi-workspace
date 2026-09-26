"""
Synthesizer registry: maps provider ids to synthesizer classes.
"""

from typing import Any, Dict, List

from .base import BaseSynthesizer, SynthError
from .cartesia import CartesiaSynthesizer
from .edge import EdgeSynthesizer
from .elevenlabs import ElevenLabsSynthesizer
from .openai_tts import OpenAISynthesizer

PROVIDER_ORDER = ["edge", "openai", "cartesia", "elevenlabs"]

PROVIDERS: Dict[str, type] = {
    EdgeSynthesizer.id: EdgeSynthesizer,
    OpenAISynthesizer.id: OpenAISynthesizer,
    CartesiaSynthesizer.id: CartesiaSynthesizer,
    ElevenLabsSynthesizer.id: ElevenLabsSynthesizer,
}


def get_synthesizer(provider_id: str, config: Dict[str, Any] = None) -> BaseSynthesizer:
    """Instantiate the synthesizer for provider_id with its settings block."""
    cls = PROVIDERS.get(provider_id)
    if cls is None:
        raise SynthError(
            f"Unknown provider '{provider_id}'. Available: {', '.join(PROVIDER_ORDER)}"
        )
    return cls(config or {})


def provider_list() -> List[Dict[str, Any]]:
    """Metadata for all providers (used by --list-providers and the dashboard)."""
    return [
        {
            "id": pid,
            "label": PROVIDERS[pid].label,
            "description": PROVIDERS[pid].description,
            "requires_key": PROVIDERS[pid].requires_key,
            "key_env": PROVIDERS[pid].key_env,
            "format": PROVIDERS[pid].format,
        }
        for pid in PROVIDER_ORDER
    ]
