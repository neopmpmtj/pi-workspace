#!/usr/bin/env bash
# ============================================================
# pi speech gateway — the ONE seam between text and hearing.
#
# Contract (stable; every surface calls this, nothing else):
#   text on stdin  ->  speech audio, OGG/Opus by default
#
#   speak.sh [-o OUT] [-l LANG] [-e ENGINE] [--play] [-t TEXT] [--limit N]
#
#     -o OUT      output file (default: mktemp .ogg). Extension decides
#                 the container: .ogg/.opus -> voice note, .wav -> raw
#     -l LANG     en (default) | pt   — voice choice, not text translation
#     -e ENGINE   auto (default) | piper | espeak
#     --play      also play through this host's speakers (laptops only;
#                 a headless server has no audio device and exits 6 instead
#                 of pretending it spoke)
#     -t TEXT     text as an argument instead of stdin
#     --limit N   max characters spoken (default 1600, 0 = no limit)
#
# Prints the absolute path of the produced file on stdout, one line.
# Exit 0 = file exists and is playable. Anything else = nothing produced.
#
# Why it exists: three surfaces (Telegram on the VPS, the laptop TUI, the
# home server later) must share ONE synthesis path, so swapping the engine
# later (better voice, paid API) is an env var here, not new code in three
# places. Nothing else in this tree may call piper/espeak directly.
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Machine-local choices live outside the repo: voice, engine, rate.
# Never committed, so each host can differ without a merge conflict.
[ -f "$HOME/.config/pi-speech.env" ] && . "$HOME/.config/pi-speech.env"

PIPER_BIN="${PIPER_BIN:-$HOME/.local/venvs/piper/bin/piper}"
PIPER_VOICES="${PIPER_VOICES:-$HOME/.local/share/piper-voices}"
ENGINE="${PI_SPEECH_ENGINE:-auto}"
LENGTH_SCALE="${PI_SPEECH_LENGTH_SCALE:-1.0}"

OUT=""
LANG_CODE="${PI_SPEECH_LANG:-en}"
TEXT=""
LIMIT="1600"
PLAY=0

while [ $# -gt 0 ]; do
    case "$1" in
        -o|--out) OUT="$2"; shift 2 ;;
        -l|--lang) LANG_CODE="$2"; shift 2 ;;
        -e|--engine) ENGINE="$2"; shift 2 ;;
        -t|--text) TEXT="$2"; shift 2 ;;
        -n|--limit) LIMIT="$2"; shift 2 ;;
        --play) PLAY=1; shift ;;
        -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "speak.sh: unknown argument: $1" >&2; exit 2 ;;
    esac
done

# --- 1. gather text -------------------------------------------------
if [ -z "$TEXT" ]; then TEXT="$(cat)"; fi
[ -n "${TEXT//[[:space:]]/}" ] || { echo "speak.sh: empty text" >&2; exit 3; }

SPOKEN="$(printf '%s' "$TEXT" | python3 "$HERE/clean.py" --limit "$LIMIT")" || {
    echo "speak.sh: nothing speakable after cleanup" >&2; exit 3
}

# --- 2. voice resolution -------------------------------------------
case "$LANG_CODE" in
    pt*) DEFAULT_VOICE="pt_PT-tugão-medium"; ESPEAK_LANG="pt-pt" ;;
    *)   DEFAULT_VOICE="en_US-lessac-medium"; ESPEAK_LANG="en-us" ;;
esac
VOICE="${PI_SPEECH_VOICE:-$DEFAULT_VOICE}"

# --- 3. output path -------------------------------------------------
TMPDIR_SYNTH="$(mktemp -d)"
cleanup() { rm -rf "$TMPDIR_SYNTH"; }
trap cleanup EXIT
if [ -z "$OUT" ]; then
    OUT="$TMPDIR_SYNTH/speech.ogg"
    KEEP_TMP=0
else
    KEEP_TMP=1
    OUT="$(cd "$(dirname "$OUT")" 2>/dev/null && pwd)/$(basename "$OUT")" 2>/dev/null || OUT="$OUT"
fi
WAV="${OUT%.*}.wav"
[ "$WAV" = "$OUT" ] && WAV="$TMPDIR_SYNTH/raw.wav"

# --- 4. synthesise with the first engine that works -----------------
synthesised=0
try_piper() {
    [ -x "$PIPER_BIN" ] || return 1
    [ -f "$PIPER_VOICES/$VOICE.onnx" ] || return 1
    printf '%s\n' "$SPOKEN" > "$TMPDIR_SYNTH/in.txt"
    "$PIPER_BIN" -m "$PIPER_VOICES/$VOICE.onnx" \
        --length-scale "$LENGTH_SCALE" \
        -i "$TMPDIR_SYNTH/in.txt" -f "$WAV" >/dev/null 2>&1 || return 1
    [ -s "$WAV" ]
}
try_espeak() {
    command -v espeak-ng >/dev/null 2>&1 || return 1
    espeak-ng -v "$ESPEAK_LANG" -s 165 -w "$WAV" --stdin <<<"$SPOKEN" >/dev/null 2>&1 || return 1
    [ -s "$WAV" ]
}

case "$ENGINE" in
    piper) try_piper || { echo "speak.sh: piper failed (voice=$VOICE)" >&2; exit 4; } ;;
    espeak) try_espeak || { echo "speak.sh: espeak-ng failed" >&2; exit 4; } ;;
    *)
        try_piper || try_espeak || {
            echo "speak.sh: no engine available (piper at $PIPER_BIN, espeak-ng absent)" >&2
            exit 4
        } ;;
esac
synthesised=1
[ "$synthesised" = 1 ] || exit 4

# --- 5. container ---------------------------------------------------
case "$OUT" in
    *.wav)
        if [ "$WAV" != "$OUT" ]; then mv -f "$WAV" "$OUT"; fi ;;
    *.ogg|*.opus)
        ffmpeg -hide_banner -loglevel error -y -i "$WAV" \
            -c:a libopus -b:a 32k -vbr on -application voip \
            -ac 1 -ar 48000 "$OUT" || { echo "speak.sh: ffmpeg failed" >&2; exit 5; } ;;
    *)
        echo "speak.sh: unsupported output extension: $OUT" >&2; exit 2 ;;
esac
[ -s "$OUT" ] || { echo "speak.sh: produced empty file" >&2; exit 5; }

# --- 6. optional local playback (loud on failure: silence is a bug here) ---
if [ "$PLAY" = 1 ]; then
    PLAYER="${PI_SPEECH_PLAYER:-}"
    if [ -z "$PLAYER" ]; then
        case "$OUT" in
            *.ogg|*.opus)
                # aplay cannot decode Opus; only these three can.
                for cand in pw-play paplay ffplay; do
                    command -v "$cand" >/dev/null 2>&1 && { PLAYER="$cand"; break; }
                done ;;
            *)
                for cand in pw-play paplay aplay ffplay; do
                    command -v "$cand" >/dev/null 2>&1 && { PLAYER="$cand"; break; }
                done ;;
        esac
    fi
    if [ -z "$PLAYER" ]; then
        echo "speak.sh: --play but no audio player on this host (headless?)" >&2
        exit 6
    fi
    case "$PLAYER" in
        ffplay) ffplay -nodisp -autoexit -loglevel quiet "$OUT" || { echo "speak.sh: ffplay failed" >&2; exit 6; } ;;
        *) "$PLAYER" "$OUT" || { echo "speak.sh: $PLAYER failed" >&2; exit 6; } ;;
    esac
fi

echo "$OUT"
