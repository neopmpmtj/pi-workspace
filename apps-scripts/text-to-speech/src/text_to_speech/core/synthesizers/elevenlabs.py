"""
ElevenLabs (top tier): POST /v1/text-to-speech/{voice_id}.

Models: eleven_flash_v2_5 (cheap/fast), eleven_turbo_v2_5, eleven_v3,
eleven_multilingual_v2 (best quality). Voice settings: stability,
similarity_boost, style, use_speaker_boost, speed.
"""

from typing import Dict, List

import requests

from .base import BaseSynthesizer, SynthError

MODELS = [
    "eleven_flash_v2_5",
    "eleven_turbo_v2_5",
    "eleven_v3",
    "eleven_multilingual_v2",
]

FALLBACK_VOICES = [
    {"id": "pMsXgVXv3BLzUgSXRplE", "name": "Rachel", "language": "en", "gender": "female"},
    {"id": "pNInz6obpgDQGcFmaJgB", "name": "Adam", "language": "en", "gender": "male"},
    {"id": "ErXwobaYiN019PkySvjV", "name": "Antoni", "language": "en", "gender": "male"},
]


class ElevenLabsSynthesizer(BaseSynthesizer):
    id = "elevenlabs"
    label = "ElevenLabs"
    description = "Top-tier voices (~$0.05/1k chars on Flash). Voice library via GET /v1/voices."
    requires_key = True
    key_env = "ELEVENLABS_API_KEY"
    url = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    voices_url = "https://api.elevenlabs.io/v1/voices"

    def synthesize(self, text: str, speed: float = 1.0) -> bytes:
        model = self.config.get("model") or "eleven_flash_v2_5"
        voice = self.config.get("voice") or FALLBACK_VOICES[0]["id"]

        def _f(key: str, default: float) -> float:
            try:
                return float(self.config.get(key, default))
            except (TypeError, ValueError):
                return default

        voice_settings = {
            "stability": min(1.0, max(0.0, _f("stability", 0.5))),
            "similarity_boost": min(1.0, max(0.0, _f("similarity", 0.75))),
            "style": min(1.0, max(0.0, _f("style", 0.0))),
            "use_speaker_boost": bool(self.config.get("use_speaker_boost", True)),
            "speed": min(2.0, max(0.5, float(speed))),
        }

        payload = {
            "text": text,
            "model_id": model,
            "voice_settings": voice_settings,
            "output_format": "mp3_44100_128",
        }

        self.logger.info("elevenlabs: model=%s voice=%s speed=%s chars=%d", model, voice, speed, len(text))

        try:
            resp = requests.post(
                self.url.format(voice_id=voice),
                headers={"xi-api-key": self.api_key, "Content-Type": "application/json"},
                json=payload,
                timeout=180,
            )
            if resp.status_code != 200:
                raise SynthError(f"ElevenLabs API error {resp.status_code}: {resp.text[:300]}")
            return resp.content
        except requests.RequestException as exc:
            raise SynthError(f"ElevenLabs request failed: {exc}") from exc

    def list_voices(self) -> List[Dict[str, str]]:
        try:
            resp = requests.get(self.voices_url, headers={"xi-api-key": self.api_key}, timeout=30)
            resp.raise_for_status()
            data = resp.json().get("voices", [])
            return [
                {
                    "id": v.get("voice_id", ""),
                    "name": v.get("name", ""),
                    "language": "",
                    "gender": "",
                }
                for v in data
                if v.get("voice_id")
            ]
        except Exception as exc:
            self.logger.warning("Failed to list ElevenLabs voices: %s", exc)
            return [dict(v) for v in FALLBACK_VOICES]
