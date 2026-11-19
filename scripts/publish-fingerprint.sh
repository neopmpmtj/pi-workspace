#!/usr/bin/env bash
# publish-fingerprint.sh — send this host's fingerprint to the peer over ssh.
#
# The VPS cannot reach the laptop (no sshd there), but the laptop always reaches the
# VPS. So the laptop publishes on session start and the VPS's nightly parity timer
# compares the two. Landing zone is ~/.pi/agent/tmp/parity/ (inside the ignored tmp/).

set -uo pipefail

. "$HOME/.pi/scripts/env.sh" 2>/dev/null || true

PEER="${PI_PEER:-neopmpmtj}"
SELF=$(hostname -s 2>/dev/null || echo unknown)

# Only the less-exposed host publishes; the VPS skips.
[ "$SELF" = "$PEER" ] && exit 0

FP=$(bash "$HOME/.pi/scripts/fingerprint.sh" 2>/dev/null) || exit 0
[ -z "$FP" ] && exit 0

TMP=$(mktemp) || exit 0
trap 'rm -f "$TMP"' EXIT
printf '%s\n' "$FP" > "$TMP"

timeout 12 ssh -o BatchMode=yes -o ConnectTimeout=8 "$PEER" 'mkdir -p ~/.pi/agent/tmp/parity' 2>/dev/null || exit 0
timeout 20 scp -q -o BatchMode=yes -o ConnectTimeout=8 "$TMP" "$PEER:~/.pi/agent/tmp/parity/$SELF.fingerprint" 2>/dev/null \
	&& echo "published fingerprint to $PEER (~/.pi/agent/tmp/parity/$SELF.fingerprint)"
exit 0
