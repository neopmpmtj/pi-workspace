#!/usr/bin/env bash
# env.sh — single source for the node/pi paths used by this repo's scripts.
#
# Source it, do not execute it:
#   . "$HOME/.pi/scripts/env.sh"
#
# Keeps `~/.nvm/versions/node/v24.21.0` in one place: a node upgrade is one edit
# here, not four. Falls back to the newest v24 available under nvm when the pinned
# tree is missing, so a script never dies just because the exact patch moved.

PI_NODE_VERSION="${PI_NODE_VERSION:-v24.21.0}"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

PI_NODE_BIN="$NVM_DIR/versions/node/$PI_NODE_VERSION/bin"
if [ ! -x "$PI_NODE_BIN/node" ]; then
  for cand in "$NVM_DIR"/versions/node/v24.*/bin "$NVM_DIR"/versions/node/*/bin; do
    [ -x "$cand/node" ] && PI_NODE_BIN="$cand"
  done
fi

export PI_NODE_BIN
export PATH="$PI_NODE_BIN:$PATH"
export PI_REPO="${PI_REPO:-$HOME/.pi}"
