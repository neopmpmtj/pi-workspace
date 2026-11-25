#!/usr/bin/env bash
# ============================================================
# print-to-screen.sh — arm exactly ONE text-only Telegram reply.
#
# The user's eyes hurt, so Telegram answers are normally spoken: the bridge
# runs `voice.replyMode: always`, turns the whole answer into a voice note, and
# sends no text. When the user wants the answer readable on the phone instead
# ("print it", "show on screen", "print to telegram"), this script arms a flag
# that scripts/speech/voice-reply.sh consumes once:
#
#     print-to-screen.sh   ->  tmp/voice-textonly.flag   (epoch seconds)
#     voice-reply.sh       ->  sees it, removes it, exits 5, emits no audio
#     bridge               ->  no voice handler succeeded -> sends the text
#
# The flag is one-shot and expires (voice-reply.sh ignores it after 20 min),
# so a turn that never reaches the voice step cannot silence a later answer.
#
# Run this in the SAME turn as the answer it applies to, before the final text.
# ============================================================
set -euo pipefail

FLAG="${PI_SPEECH_TEXTONLY_FLAG:-$HOME/.pi/agent/tmp/voice-textonly.flag}"
mkdir -p "$(dirname "$FLAG")"
date +%s >"$FLAG"
echo "text-only armed: $FLAG"
