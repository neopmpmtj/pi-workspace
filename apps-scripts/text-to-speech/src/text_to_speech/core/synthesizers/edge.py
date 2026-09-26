"""
Microsoft Edge neural voices via edge-tts — free, no API key.

The same Microsoft online neural TTS that OpenClaw's `microsoft` provider
uses under the hood, called directly from this machine.
"""

import asyncio
import io
from typing import Any, Dict, List

import edge_tts

from .base import BaseSynthesizer, SynthError

FALLBACK_VOICES = [
    "en-US-MichelleNeural",
    "en-US-AriaNeural",
    "en-US-GuyNeural",
    "en-GB-SoniaNeural",
    "en-GB-RyanNeural",
    "pt-PT-FernandaNeural",
    "pt-BR-FranciscaNeural",
    "es-ES-ElviraNeural",
    "fr-FR-DeniseNeural",
    "de-DE-KatjaNeural",
    "it-IT-ElsaNeural",
]


def _speed_to_rate(speed: float) -> str:
    """Global speed (0.5-2.0) -> edge-tts rate percent string."""
    percent = int(round((speed - 1.0) * 100))
    percent = max(-50, min(100, percent))
    return f"{percent:+d}%"


class EdgeSynthesizer(BaseSynthesizer):
    id = "edge"
    label = "Microsoft Edge (free)"
    description = "Microsoft Edge online neural voices via edge-tts. Free, no API key."
    requires_key = False
    key_env = ""

    def synthesize(self, text: str, speed: float = 1.0) -> bytes:
        voice = self.config.get("voice") or "en-US-MichelleNeural"
        rate = self.config.get("rate") or _speed_to_rate(speed)
        pitch = self.config.get("pitch") or "+0Hz"
        volume = self.config.get("volume") or "+0%"

        self.logger.info(
            "edge-tts: voice=%s rate=%s pitch=%s volume=%s chars=%d",
            voice, rate, pitch, volume, len(text),
        )

        buf = io.BytesIO()

        async def _run() -> None:
            comm = edge_tts.Communicate(
                text=text, voice=voice, rate=rate, pitch=pitch, volume=volume
            )
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    buf.write(chunk["data"])

        asyncio.run(_run())

        if buf.tell() == 0:
            raise SynthError("edge-tts returned no audio data")
        return buf.getvalue()

    def list_voices(self) -> List[Dict[str, str]]:
        try:
            voices = asyncio.run(edge_tts.list_voices())
            return [
                {
                    "id": v["ShortName"],
                    "name": v["ShortName"],
                    "language": v.get("Locale", ""),
                    "gender": v.get("Gender", ""),
                }
                for v in voices
            ]
        except Exception as exc:
            self.logger.warning("Failed to list edge voices: %s", exc)
            return [{"id": v, "name": v, "language": "", "gender": ""} for v in FALLBACK_VOICES]
