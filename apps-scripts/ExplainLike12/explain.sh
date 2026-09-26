#!/bin/bash
# ============================================================
# ExplainLike12 — hotkey wrapper
#
# Bound to Ctrl+Alt+L in GNOME (custom12).
# Reads the clipboard, asks the LLM to explain it for a bright
# 12-year-old, and pastes the explanation at the cursor.
# ============================================================

APP_DIR="$HOME/.pi/apps-scripts/ExplainLike12"
PYTHON="$APP_DIR/.venv/bin/python3"

cd "$APP_DIR" || exit 1

# Load the OpenAI key into this non-interactive environment.
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

exec "$PYTHON" -m explain_like
