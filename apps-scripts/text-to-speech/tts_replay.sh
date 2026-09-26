#!/bin/bash
# ============================================================
# text-to-speech — replay the last recording (Ctrl+Alt+P)
#
# Plays the newest generated audio file in the output folder.
# ============================================================

APP_DIR="$HOME/.pi/apps-scripts/text-to-speech"
PYTHON="$APP_DIR/.venv/bin/python3"

cd "$APP_DIR" || exit 1

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

exec "$PYTHON" -m text_to_speech --replay
