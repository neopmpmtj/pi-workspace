"""
Cartesia Sonic (mid+ tier): sonic-3.6 models via POST /tts/bytes.

Auth: X-API-Key + Cartesia-Version headers.
Voice ids are UUIDs; several well-known built-in voices ship as fallbacks.
"""

from typing import Dict, List

import requests

from .base import BaseSynthesizer, SynthError

MODELS = ["sonic-3.6", "sonic-3.5", "sonic-3", "sonic-latest"]

FALLBACK_VOICES = [
    {"id": "0834f3df-e650-4766-a20c-5a93a43aa6e3", "name": "Leo", "language": "en", "gender": "male"},
    {"id": "6776173b-fd72-460d-89b3-d85812ee518d", "name": "Jace", "language": "en", "gender": "male"},
    {"id": "c961b81c-a935-4c17-bfb3-ba2239de8c2f", "name": "Kyle", "language": "en", "gender": "male"},
    {"id": "f4a3a8e4-694c-4c45-9ca0-27caf97901b5", "name": "Gavin", "language": "en", "gender": "male"},
    {"id": "cbaf8084-f009-4838-a096-07ee2e6612b1", "name": "Maya", "language": "en", "gender": "female"},
    {"id": "6ccbfb76-1fc6-48f7-b71d-91ac6298247b", "name": "Tessa", "language": "en", "gender": "female"},
    {"id": "cc00e582-ed66-4004-8336-0175b85c85f6", "name": "Dana", "language": "en", "gender": "female"},
    {"id": "26403c37-80c1-4a1a-8692-540551ca2ae5", "name": "Marian", "language": "en", "gender": "female"},
]

EMOTIONS = [
    "neutral", "calm", "angry", "content", "sad", "scared", "happy", "excited",
    "curious", "sarcastic", "wistful", "determined", "confident", "sympathetic",
]


class CartesiaSynthesizer(BaseSynthesizer):
    id = "cartesia"
    label = "Cartesia Sonic"
    description = "Sonic 3.6 — fast, natural voices (per-char credits; free starter tier)."
    requires_key = True
    key_env = "CARTESIA_API_KEY"
    url = "https://api.cartesia.ai/tts/bytes"
    voices_url = "https://api.cartesia.ai/voices"
    version = "2026-08-14"

    def synthesize(self, text: str, speed: float = 1.0) -> bytes:
        model = self.config.get("model") or "sonic-3.6"
        voice = self.config.get("voice") or FALLBACK_VOICES[0]["id"]

        generation_config: Dict = {"speed": max(0.6, min(1.5, float(speed)))}
        emotion = (self.config.get("emotion") or "").strip()
        if emotion:
            generation_config["emotion"] = emotion

        payload = {
            "model_id": model,
            "transcript": text,
            "output_format": {
                "container": "mp3",
                "encoding": "mp3",
                "sample_rate": 44100,
                "bit_rate": 128000,
            },
            "generation_config": generation_config,
        }

        headers = {
            "X-API-Key": self.api_key,
            "Cartesia-Version": self.version,
            "Content-Type": "application/json",
        }

        self.logger.info("cartesia: model=%s voice=%s speed=%s emotion=%r chars=%d",
                         model, voice, speed, emotion, len(text))

        # Current API accepts the voice as an object {"mode": "id", "id": ...};
        # newer docs show a plain id string. Try object form first, then string.
        last_status, last_body = 0, ""
        for voice_shape in ({"mode": "id", "id": voice}, voice):
            payload["voice"] = voice_shape
            try:
                resp = requests.post(self.url, headers=headers, json=payload, timeout=120)
            except requests.RequestException as exc:
                raise SynthError(f"Cartesia request failed: {exc}") from exc
            last_status, last_body = resp.status_code, resp.text[:300]
            if resp.status_code == 200:
                return resp.content
            if resp.status_code in (400, 404, 422):  # maybe the other voice shape
                continue
            break

        raise SynthError(f"Cartesia API error {last_status}: {last_body}")

    def list_voices(self) -> List[Dict[str, str]]:
        try:
            resp = requests.get(
                self.voices_url,
                headers={"X-API-Key": self.api_key, "Cartesia-Version": self.version},
                timeout=30,
            )
            resp.raise_for_status()
            return [
                {
                    "id": v.get("id", ""),
                    "name": v.get("name", ""),
                    "language": v.get("language", ""),
                    "gender": "",
                }
                for v in resp.json()
                if v.get("id")
            ]
        except Exception as exc:
            self.logger.warning("Failed to list Cartesia voices: %s", exc)
            return [dict(v) for v in FALLBACK_VOICES]
