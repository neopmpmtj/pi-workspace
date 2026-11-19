#!/usr/bin/env bash
# sync-hosts.sh — keep the laptop and the VPS on the same commit and show drift.
#
#   bash ~/.pi/scripts/sync-hosts.sh check    # read-only: fetch, report, run parity
#   bash ~/.pi/scripts/sync-hosts.sh pull     # fast-forward BOTH hosts from origin
#   bash ~/.pi/scripts/sync-hosts.sh push     # push local commits, then pull the VPS
#   bash ~/.pi/scripts/sync-hosts.sh setup    # install the git hooks on both hosts
#
# Why it exists:
# - `git pull` can answer "Already up to date" when its fetch did not bring the new
#   ref. Every pull here is `git fetch --all --prune` followed by `pull --ff-only`,
#   so a stale ref can never mask a lagging host.
# - A fresh clone is not usable until the skill submodules are initialised; `pull`
#   runs `git submodule update --init --recursive`.
# - Drift that git cannot see (pi version, pinned package, settings core, submodules)
#   is covered by scripts/check-host-parity.sh, which every mode ends with.
#
# Never commits: extensions/auto-sync.ts owns commit-on-shutdown. Never resets:
# a dirty tree is reported, not repaired.

set -uo pipefail

REMOTE="${REMOTE:-neopmpmtj}"
. "$HOME/.pi/scripts/env.sh"
NODE_BIN="$PI_NODE_BIN"
REPO="$PI_REPO"
REMOTE_REPO='$HOME/.pi'
MODE="${1:-check}"

export PATH="$NODE_BIN:$PATH"

local_git() { git -C "$REPO" "$@"; }

fetch_local() {
  local_git fetch --all --prune --quiet 2>/dev/null || { echo "[FAIL] laptop fetch"; return 1; }
}

fetch_remote() {
  ssh -o BatchMode=yes "$REMOTE" "cd $REMOTE_REPO && git fetch --all --prune --quiet" 2>/dev/null \
    || { echo "[FAIL] VPS fetch"; return 1; }
}

# ahead/behind against origin/main
local_counts() {
  local_git rev-list --left-right --count 'HEAD...origin/main' 2>/dev/null | awk '{print $1" "$2}'
}
remote_counts() {
  ssh -o BatchMode=yes "$REMOTE" "cd $REMOTE_REPO && git rev-list --left-right --count HEAD...origin/main" 2>/dev/null | awk '{print $1" "$2}'
}

report() {
  fetch_local || return 1
  fetch_remote || return 1

  local la lb ra rb lh rh ldir rdir
  read -r la lb <<< "$(local_counts)"
  read -r ra rb <<< "$(remote_counts)"
  lh=$(local_git rev-parse --short HEAD)
  rh=$(ssh -o BatchMode=yes "$REMOTE" "cd $REMOTE_REPO && git rev-parse --short HEAD")
  ldir=$(local_git status --porcelain | wc -l | tr -d ' ')
  rdir=$(ssh -o BatchMode=yes "$REMOTE" "cd $REMOTE_REPO && git status --porcelain | wc -l" | tr -d ' ')

  printf '%-8s %-14s %-14s\n' HOST HEAD 'ahead/behind'
  printf '%-8s %-14s %-14s\n' laptop "$lh" "$la ahead, $lb behind"
  printf '%-8s %-14s %-14s\n' VPS "$rh" "$ra ahead, $rb behind"
  printf 'dirty:  laptop=%s  VPS=%s\n' "$ldir" "$rdir"
}

pull_both() {
  fetch_local || return 1
  local before after
  before=$(local_git rev-parse --short HEAD)
  local_git pull --ff-only --quiet || { echo "[FAIL] laptop pull not fast-forward"; return 1; }
  after=$(local_git rev-parse --short HEAD)
  [ "$before" != "$after" ] && echo "laptop: $before -> $after" || echo "laptop: up to date ($after)"
  local_git submodule update --init --recursive --quiet && echo "laptop: submodules ok"

  fetch_remote || return 1
  local rbefore rafter
  rbefore=$(ssh -o BatchMode=yes "$REMOTE" "cd $REMOTE_REPO && git rev-parse --short HEAD")
  ssh -o BatchMode=yes "$REMOTE" "cd $REMOTE_REPO && git pull --ff-only --quiet" || { echo "[FAIL] VPS pull not fast-forward"; return 1; }
  rafter=$(ssh -o BatchMode=yes "$REMOTE" "cd $REMOTE_REPO && git rev-parse --short HEAD")
  [ "$rbefore" != "$rafter" ] && echo "VPS: $rbefore -> $rafter" || echo "VPS: up to date ($rafter)"
  ssh -o BatchMode=yes "$REMOTE" "cd $REMOTE_REPO && git submodule update --init --recursive --quiet" && echo "VPS: submodules ok"
}

push_then_pull() {
  fetch_local || return 1
  local la
  la=$(local_counts | awk '{print $1}')
  if [ "${la:-0}" -gt 0 ]; then
    local_git push || { echo "[FAIL] laptop push"; return 1; }
    echo "laptop: pushed $la commit(s)"
  else
    echo "laptop: nothing to push"
  fi
  pull_both
}

setup_hooks() {
  local_git config core.hooksPath .githooks
  echo "laptop: core.hooksPath=.githooks"
  ssh -o BatchMode=yes "$REMOTE" "cd $REMOTE_REPO && git config core.hooksPath .githooks" \
    && echo "VPS: core.hooksPath=.githooks"
  local_git submodule update --init --recursive --quiet
  echo "laptop: submodules ok"
}

case "$MODE" in
  check) report ;;
  pull)  pull_both ;;
  push)  push_then_pull ;;
  setup) setup_hooks ;;
  *) echo "usage: $(basename "$0") [check|pull|push|setup]"; exit 2 ;;
esac

rc=$?
echo
bash "$HOME/.pi/scripts/check-host-parity.sh"
parc=$?
[ "$parc" -ne 0 ] && rc=$parc
exit $rc
