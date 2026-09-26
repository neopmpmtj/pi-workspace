"""
OpenAI TTS (mid tier): gpt-4o-mini-tts / tts-1 / tts-1-hd.

POST https://api.openai.com/v1/audio/speech
Reuses the existing OPENAI_API_KEY (~$0.015/min of audio).
"""

from typing import Dict, List

import requests

from .base import BaseSynthesizer, SynthError

VOICES = [
    "alloy", "ash", "ballad", "coral", "echo",
    "fable", "nova", "onyx", "sage", "shimmer",
]
MODELS = ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"]


class OpenAISynthesizer(BaseSynthesizer):
    id = "openai"
    label = "OpenAI TTS"
    description = "gpt-4o-mini-tts / tts-1. Cheap (~$0.015/min), reuses your OPENAI_API_KEY."
    requires_key = True
    key_env = "OPENAI_API_KEY"
    url = "https://api.openai.com/v1/audio/speech"

    def synthesize(self, text: str, speed: float = 1.0) -> bytes:
        model = self.config.get("model") or "gpt-4o-mini-tts"
        voice = self.config.get("voice") or "coral"
        instructions = (self.config.get("instructions") or "").strip()

        payload = {
            "model": model,
            "voice": voice,
            "input": text,
            "speed": max(0.25, min(4.0, float(speed))),
            "response_format": "mp3",
        }
        if instructions:
            payload["instructions"] = instructions

        self.logger.info("openai tts: model=%s voice=%s speed=%s chars=%d", model, voice, speed, len(text))

        try:
            resp = requests.post(
                self.url,
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=payload,
                timeout=120,
            )
            if resp.status_code != 200:
                raise SynthError(f"OpenAI API error {resp.status_code}: {resp.text[:300]}")
            return resp.content
        except requests.RequestException as exc:
            raise SynthError(f"OpenAI request failed: {exc}") from exc

    def list_voices(self) -> List[Dict[str, str]]:
        return [{"id": v, "name": v, "language": "en", "gender": ""} for v in VOICES]
