#!/bin/bash
# Wrapper script for text_rewrite package
# This script sets up the Python path and runs the text_rewrite module

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Change to the script directory
cd "$SCRIPT_DIR"

# Load API keys into this non-interactive environment.
# The app's own .env is the PRIMARY source (sourced last so it wins);
# ~/.config/openai.env is only a fallback.
set -a
if [ -f "$HOME/.config/openai.env" ]; then
    # shellcheck source=/dev/null
    . "$HOME/.config/openai.env"
fi
if [ -f "$SCRIPT_DIR/.env" ]; then
    # shellcheck source=/dev/null
    . "$SCRIPT_DIR/.env"
else
    echo "[$(date)] WARNING: $SCRIPT_DIR/.env not found; using fallback only" >&2
fi
set +a

# Set PYTHONPATH to include the project root
export PYTHONPATH="$SCRIPT_DIR:$PYTHONPATH"

# Activate virtual environment if it exists
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi

# Run the text_rewrite module with all passed arguments
python3 -m src.text_rewrite "$@"

# Exit with the same code as the Python script
exit $?

