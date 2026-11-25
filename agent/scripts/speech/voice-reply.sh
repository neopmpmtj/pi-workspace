#!/usr/bin/env bash
# ============================================================
# voice-reply.sh — Telegram voice handler gate, one turn at a time.
#
# Wired in agent/telegram.json as the `voice` outbound handler:
#
#     ~/.pi/agent/scripts/speech/voice-reply.sh -o {ogg}
#
# Normal turn: behaves exactly like speak.sh (exec, same args, same stdout).
#
# Text-only turn: print-to-screen.sh armed ~/.pi/agent/tmp/voice-textonly.flag,
# so this consumes it, prints nothing and exits 5. The bridge records a
# voice-handler failure, has no other provider, and falls back to sending the
# planned text reply — which is the whole point.
#
# A stale flag (older than 20 min) is ignored: it means a turn ended without a
# voice step, and it must never silence a later answer.
#
# Exit codes: 0 speak.sh succeeded | 5 suppressed on request | other speak.sh
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLAG="${PI_SPEECH_TEXTONLY_FLAG:-$HOME/.pi/agent/tmp/voice-textonly.flag}"
MAX_AGE="${PI_SPEECH_TEXTONLY_TTL:-1200}" # seconds

if [ -f "$FLAG" ]; then
    armed="$(head -n1 "$FLAG" 2>/dev/null || true)"
    now="$(date +%s)"
    case "$armed" in
        '' | *[!0-9]*) age=$((MAX_AGE + 1)) ;;
        *) age=$((now - armed)) ;;
    esac
    rm -f "$FLAG"
    if [ "$age" -ge 0 ] && [ "$age" -lt "$MAX_AGE" ]; then
        exit 5
    fi
fi

exec "$HERE/speak.sh" "$@"
