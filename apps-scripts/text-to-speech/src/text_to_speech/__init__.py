"""
text_to_speech — hotkey-driven text-to-speech app.

Select text -> copy -> press Ctrl+Alt+S -> clipboard text is synthesized by
the currently selected provider, saved as an audio file, and played back.

Providers:
  - edge      Microsoft Edge neural voices (edge-tts) — free, no API key
  - openai    OpenAI TTS (gpt-4o-mini-tts / tts-1) — cheap mid tier
  - cartesia  Cartesia Sonic — fast, natural mid+ tier
  - elevenlabs ElevenLabs — top tier
"""

from pathlib import Path

# App root: .../text-to-speech/src/text_to_speech/__init__.py -> parents[2]
APP_ROOT = Path(__file__).resolve().parent.parent.parent
STATE_FILE = APP_ROOT / ".tts_state.json"
ENV_FILE = APP_ROOT / ".env"

# Load the project .env (if present) so API keys are available everywhere.
# override=True: the app's own .env is the PRIMARY key source and wins over
# anything already in the environment (e.g. ~/.config/openai.env sourced by
# the shell wrappers as a fallback), so per-app key rotation always works.
try:
    from dotenv import load_dotenv

    load_dotenv(ENV_FILE, override=True)
except Exception:  # pragma: no cover - dotenv is a hard dependency, but stay safe
    pass

__version__ = "0.1.0"
