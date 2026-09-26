#!/bin/bash
# ============================================================
# text-to-speech — hotkey wrapper
#
# Bound to Ctrl+Alt+S in GNOME Settings → Keyboard → Custom Shortcuts.
# Reads the clipboard, synthesizes speech with the current provider,
# saves the audio file, and plays it back.
# ============================================================

APP_DIR="$HOME/.pi/apps-scripts/text-to-speech"
PYTHON="$APP_DIR/.venv/bin/python3"

cd "$APP_DIR" || exit 1

# Load API keys into this non-interactive environment.
# The OpenAI key lives in ~/.config/openai.env; project .env can hold the rest.
set -a
if [ -f "$HOME/.config/openai.env" ]; then
    # shellcheck source=/dev/null
    . "$HOME/.config/openai.env"
fi
if [ -f "$APP_DIR/.env" ]; then
    # shellcheck source=/dev/null
    . "$APP_DIR/.env"
fi
set +a

exec "$PYTHON" -m text_to_speech
