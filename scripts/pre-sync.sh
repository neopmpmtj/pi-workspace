#!/usr/bin/env bash
# pre-sync.sh — debounced fast-forward pull, called by the launchers at start.
#
# Fast-forward only, so a dirty or diverged tree is never rewritten on startup.
# Skipped inside subagents, and debounced so bursts of invocations do not hammer
# GitHub. Never fatal — but never silent either: when the clone ends up ahead of
# or behind origin, it says so and points at scripts/sync-hosts.sh.
#
# Run as a script (not sourced) so its `set -uo pipefail` cannot leak into the
# launcher's shell.

set -uo pipefail

# Subagents share the parent's repo; never let a child race the parent's sync.
if [ -n "${PI_SUBAGENT_STACK:-}${PI_SUBAGENT_DEPTH:-}${PI_SUBAGENT_DELEGATION:-}${PI_SUBAGENT_TEMP_PARENT_SESSION:-}" ]; then
	exit 0
fi

REPO="${PI_REPO:-$HOME/.pi}"
[ -d "$REPO/.git" ] || exit 0

MARKER="$HOME/.cache/pi-workspace-last-pull"
now=$(date +%s)
last=$(cat "$MARKER" 2>/dev/null || echo 0)
case "$last" in ''|*[!0-9]*) last=0 ;; esac
[ $((now - last)) -gt 120 ] || exit 0

if err=$(timeout 15 git -C "$REPO" pull --ff-only --quiet 2>&1); then
	:
else
	reason=$(printf '%s' "${err:-timed out or git unavailable}" | tr '\n' ' ' | cut -c1-160)
	echo "pi: workspace pull skipped — $reason" >&2
	# The pull may have been skipped on a stale ref. Fetch once so the report below
	# reflects origin, not the last time this host happened to look.
	timeout 10 git -C "$REPO" fetch --all --prune --quiet 2>/dev/null || true
fi

if git -C "$REPO" rev-parse --verify --quiet '@{u}' >/dev/null 2>&1; then
	counts=$(git -C "$REPO" rev-list --left-right --count 'HEAD...@{u}' 2>/dev/null)
	ahead=$(printf '%s' "$counts" | awk '{print $1}')
	behind=$(printf '%s' "$counts" | awk '{print $2}')
	if [ "${behind:-0}" -gt 0 ] || [ "${ahead:-0}" -gt 0 ]; then
		echo "pi: this clone is ${ahead:-?} ahead / ${behind:-?} behind origin — run: bash ~/.pi/scripts/sync-hosts.sh pull" >&2
	fi
fi

# Publish this host's fingerprint so the peer's nightly parity check can compare.
[ -x "$HOME/.pi/scripts/publish-fingerprint.sh" ] && timeout 20 bash "$HOME/.pi/scripts/publish-fingerprint.sh" >/dev/null 2>&1

mkdir -p "$HOME/.cache" 2>/dev/null && date +%s > "$MARKER" 2>/dev/null
exit 0
