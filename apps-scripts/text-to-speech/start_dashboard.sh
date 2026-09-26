#!/bin/bash
# ============================================================
# text-to-speech — settings dashboard launcher
# Serves the web dashboard on http://127.0.0.1:8031
# ============================================================

APP_DIR="$HOME/.pi/apps-scripts/text-to-speech"
PYTHON="$APP_DIR/.venv/bin/python3"

cd "$APP_DIR/web_dashboard" || exit 1

# Load API keys so voice listing / preview work on the dashboard.
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

exec "$PYTHON" manage.py runserver 127.0.0.1:8031 --noreload
