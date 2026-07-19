#!/bin/bash
# Wrapper script for text_rewrite package
# This script sets up the Python path and runs the text_rewrite module

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Change to the script directory
cd "$SCRIPT_DIR"

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

