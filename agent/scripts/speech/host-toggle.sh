#!/usr/bin/env bash
# ============================================================
# host-toggle.sh — read or write this host's speech switches, as JSON.
#
#   host-toggle.sh status
#   host-toggle.sh set tui on|off        PI_SPEECH_TUI      (laptop TUI answers)
#   host-toggle.sh set telegram on|off   PI_SPEECH_TELEGRAM (Telegram voice notes)
#
# Prints ONE JSON object on stdout:
#   {"host":"…","file":"~/.config/pi-speech.env","tui":false,"telegram":true,
#    "speak":"ok"}
#   tui:      read as the TUI extension reads it — absent means off.
#   telegram: read as speak.sh reads it — absent means on (no gate).
# Exit: 0 done · 2 usage · 3 the env file could not be written.
#
# Why a script at all: the project site on :8786 calls this locally AND over
# ssh (`ssh neopmpmtj 'exec "$HOME/.pi/agent/scripts/speech/host-toggle.sh" …'`),
# so both hosts answer with one shape and one set of rules. The rules
# themselves live in agent/src/speech-switch.ts — never re-implemented here.
#
# Telegram takes effect on the next reply: the bridge spawns speak.sh per
# voice artifact and speak.sh reads PI_SPEECH_TELEGRAM each time. No restart.
# The TUI takes effect on the next answer: speech-reply.ts reads PI_SPEECH_TUI
# every turn. No restart either.
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"   # ~/.pi/agent

NODE="${PI_AGENT_NODE:-}"
if [ -z "$NODE" ]; then
    NODE="$(command -v node 2>/dev/null || true)"
fi
if [ -z "$NODE" ]; then
    # A non-interactive shell (systemd, ssh, the site) has no nvm function:
    # take the newest installed node directly.
    NODE="$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -n1 || true)"
fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
    echo '{"error":"node not found; set PI_AGENT_NODE"}'
    exit 3
fi

exec "$NODE" --experimental-strip-types "$ROOT/src/speech-env-cli.ts" "$@"
