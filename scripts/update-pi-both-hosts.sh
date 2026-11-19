#!/usr/bin/env bash
# update-pi-both-hosts.sh — upgrade pi on the laptop AND the VPS, then verify.
#
# `pi update` bumps only the global install on the host that runs it, which is
# invisible to git. This wrapper does both sides in one go and then compares
# them with scripts/check-host-parity.sh, so the two never split silently.
#
# Usage: bash ~/.pi/scripts/update-pi-both-hosts.sh [--yes]
#   --yes   skip the confirmation prompt
#
# Notes:
# - The VPS agent runs inside tmux (user unit pi-vps-agent). A pi upgrade does
#   not affect the running process until that session restarts, so the wrapper
#   restarts it and checks the Telegram line comes back.
# - Needs passwordless ssh to the VPS as configured in ~/.ssh/config.

set -uo pipefail

REMOTE="${REMOTE:-neopmpmtj}"
. "$HOME/.pi/scripts/env.sh"
NODE_BIN="$PI_NODE_BIN"
ASSUME_YES=0
[ "${1:-}" = "--yes" ] && ASSUME_YES=1

export PATH="$NODE_BIN:$PATH"

say() { printf '\n== %s\n' "$*"; }

say "current versions"
echo "laptop: $(pi --version)"
echo "vps:    $(ssh -o BatchMode=yes "$REMOTE" "$NODE_BIN/pi --version")"
echo "latest: $(npm view @earendil-works/pi-coding-agent version 2>/dev/null)"

if [ "$ASSUME_YES" -eq 0 ]; then
  printf '\nUpgrade both hosts now? [y/N] '
  read -r ans
  case "$ans" in y|Y|yes|YES) ;; *) echo "aborted"; exit 1 ;; esac
fi

say "updating laptop"
pi update || { echo "[FAIL] laptop update"; exit 1; }

say "updating VPS"
ssh -o BatchMode=yes "$REMOTE" "$NODE_BIN/pi update" || { echo "[FAIL] VPS update"; exit 1; }

say "restarting the VPS agent so it loads the new pi"
ssh -o BatchMode=yes "$REMOTE" 'systemctl --user restart pi-vps-agent' || echo "[WARN] restart failed — check: systemctl --user status pi-vps-agent"

say "installing packages on both hosts (pinned specs)"
(cd "$HOME/.pi/agent/npm" && npm ci --omit=dev --legacy-peer-deps) || echo "[WARN] laptop agent/npm install failed"
ssh -o BatchMode=yes "$REMOTE" "cd ~/.pi/agent/npm && $NODE_BIN/npm ci --omit=dev --legacy-peer-deps" || echo "[WARN] VPS agent/npm install failed"

say "waiting for the VPS bridge"
for _ in $(seq 1 20); do
  if ssh -o BatchMode=yes "$REMOTE" 'tmux -L pi-cos capture-pane -p -t pi-cos:0 2>/dev/null | grep -q "telegram connected"'; then
    echo "telegram connected"
    break
  fi
  sleep 3
done

say "parity"
bash "$HOME/.pi/scripts/check-host-parity.sh"
