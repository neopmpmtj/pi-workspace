#!/usr/bin/env bash
# host-sudo-mode.sh — turn passwordless sudo for this user ON or OFF.
#
# Why it exists: the pi agent runs as `pmpmt` and has no silent root, so every
# privileged command has to be handed to the human. This script installs one
# sudoers drop-in that makes `sudo` work without a password for pmpmt, and
# (more importantly) removes it again in one step.
#
# The direction is deliberate: OFF is free, ON costs a password.
#   - While the rule is active, `sudo -n` works, so `off` needs no password.
#   - Once the rule is gone, re-enabling needs the human's password again.
# So nothing that has taken over the pmpmt account can silently give itself
# root back.
#
# Usage:
#   host-sudo-mode.sh status     # is passwordless sudo active right now?
#   host-sudo-mode.sh on         # install the drop-in (prompts for password)
#   host-sudo-mode.sh off        # remove it (no password while it is active)
#   host-sudo-mode.sh show       # print the rule that would be installed
#
# Revert = `off`. The rule is one file; deleting it is the whole undo.

set -euo pipefail

RULE_SRC_NAME="90-pi-agent"
RULE_PATH="/etc/sudoers.d/$RULE_SRC_NAME"
PARK_DIR="/etc/pi-agent"
PARK_PATH="$PARK_DIR/sudo-rule.parked"
USER_NAME="${SUDO_USER:-$(id -un)}"

rule_text() {
	cat <<-EOF
	# Passwordless sudo for the pi agent (user $USER_NAME).
	# Managed by ~/.pi/scripts/host-sudo-mode.sh — do not edit by hand.
	# Turn OFF at any time with:  bash ~/.pi/scripts/host-sudo-mode.sh off
	$USER_NAME ALL=(ALL:ALL) NOPASSWD: ALL
	EOF
}

is_active() {
	# A live sudo timestamp from an earlier sudo in the same terminal also makes
	# `sudo -n` succeed, which is NOT the same as a NOPASSWD rule. Drop the cached
	# credential first (sudo -k needs no password), then ask again: only a real
	# NOPASSWD rule can answer without input.
	sudo -k 2>/dev/null || true
	sudo -n true 2>/dev/null
}

cmd_status() {
	if is_active; then
		echo "passwordless sudo: ACTIVE"
	else
		echo "passwordless sudo: off (sudo asks for a password)"
	fi
	[ -e "$RULE_PATH" ] && echo "rule file: $RULE_PATH present" || echo "rule file: $RULE_PATH absent"
	[ -e "$PARK_PATH" ] && echo "parked copy: $PARK_PATH present (restore with: on)"
	return 0
}

cmd_show() {
	echo "--- $RULE_PATH (would contain) ---"
	rule_text
}

cmd_on() {
	if is_active; then
		echo "already active; nothing to do"
		return 0
	fi
	local tmp
	tmp="$(mktemp)"
	trap "rm -f '$tmp'" EXIT
	# `on` is the one path that legitimately needs the human's password. Ask for
	# it up front so a failure below is a real parse/install problem, not a
	# missing terminal.
	if ! sudo -v; then
		echo "[FAIL] sudo needs your password and no terminal is attached here." >&2
		echo "       Run this in your own terminal:  bash $0 on" >&2
		return 1
	fi
	rule_text >"$tmp"
	# Validate before touching /etc/sudoers.d — a broken file there locks sudo out.
	if ! sudo visudo -cf "$tmp" >/dev/null; then
		echo "[FAIL] the generated rule does not parse; nothing installed" >&2
		return 1
	fi
	sudo install -d -m 0755 -o root -g root /etc/sudoers.d
	sudo install -m 0440 -o root -g root "$tmp" "$RULE_PATH"
	if ! sudo visudo -cf "$RULE_PATH" >/dev/null; then
		echo "[FAIL] installed rule failed validation; removing it again" >&2
		sudo rm -f "$RULE_PATH"
		return 1
	fi
	sudo -k # drop the cached timestamp so the next call proves NOPASSWD works
	if is_active; then
		echo "passwordless sudo: ON  ($RULE_PATH)"
		echo "turn it off with: bash $0 off"
	else
		echo "[FAIL] rule installed but sudo still asks for a password; check /etc/sudoers include" >&2
		return 1
	fi
}

cmd_off() {
	if [ ! -e "$RULE_PATH" ] && ! is_active; then
		echo "already off; nothing to do"
		return 0
	fi
	# Keep a parked copy so `on` is one command later; it is inert outside sudoers.d.
	sudo -n install -d -m 0700 -o root -g root "$PARK_DIR" 2>/dev/null ||
		sudo install -d -m 0700 -o root -g root "$PARK_DIR"
	sudo -n mv -f "$RULE_PATH" "$PARK_PATH" 2>/dev/null ||
		sudo mv -f "$RULE_PATH" "$PARK_PATH"
	sudo -k 2>/dev/null || true
	if is_active; then
		echo "[WARN] rule removed but sudo still works without a password — check for other NOPASSWD entries (sudo -l)" >&2
	else
		echo "passwordless sudo: off (rule parked at $PARK_PATH)"
	fi
}

main() {
	case "${1:-status}" in
	on) cmd_on ;;
	off) cmd_off ;;
	status) cmd_status ;;
	show) cmd_show ;;
	*)
		echo "usage: $0 {status|on|off|show}" >&2
		exit 2
		;;
	esac
}

main "$@"
