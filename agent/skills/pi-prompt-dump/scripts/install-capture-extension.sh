#!/usr/bin/env bash
# Install the pi-prompt-capture extension into pi's user extension directory.
#
# Creates a symlink so the skill remains the single source of truth. Reversible:
#   rm ~/.pi/agent/extensions/pi-prompt-capture.ts
#
# Run /reload inside a pi session (or restart pi) after installing.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/extensions/pi-prompt-capture.ts"
DEST_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/extensions"
DEST="$DEST_DIR/pi-prompt-capture.ts"

if [[ ! -f "$SRC" ]]; then
  echo "install-capture-extension: source not found: $SRC" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"

if [[ -e "$DEST" || -L "$DEST" ]]; then
  echo "Already present: $DEST"
  ls -l "$DEST"
  exit 0
fi

ln -s "$SRC" "$DEST"
echo "Installed: $DEST -> $SRC"
echo "Run /reload in an active pi session to activate capture."
