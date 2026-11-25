#!/usr/bin/env bash
# ============================================================
# pi speech — one-time setup for a host (idempotent, re-runnable).
#
#   bash ~/.pi/agent/scripts/speech/setup-host.sh [--no-wire] [--quiet]
#
# Does four things, each skipped if already done:
#   1. piper into a user venv      ~/.local/venvs/piper   (no sudo, no root)
#   2. voice models               ~/.local/share/piper-voices
#   3. machine-local choices      ~/.config/pi-speech.env  (created once)
#   4. Telegram bridge wiring     agent/telegram.json      (voice handler +
#                                 voice.replyMode=always; backed up first)
#
# Run it on every new host (laptop, VPS, home server). Nothing here is
# host-specific except the two paths above, so there is exactly one command
# to remember and no per-host fork of this tree.
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="${PI_SPEECH_VENV:-$HOME/.local/venvs/piper}"
VOICES="${PIPER_VOICES:-$HOME/.local/share/piper-voices}"
ENV_FILE="$HOME/.config/pi-speech.env"
TELEGRAM_JSON="$HOME/.pi/agent/telegram.json"
WANT_VOICES=("en_US-lessac-medium" "pt_PT-tugão-medium")
WIRE=1
QUIET=0
for arg in "$@"; do
    case "$arg" in
        --no-wire) WIRE=0 ;;
        --quiet) QUIET=1 ;;
        -h|--help) sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "setup-host.sh: unknown argument: $arg" >&2; exit 2 ;;
    esac
done

say() { [ "$QUIET" = 1 ] || printf '%s\n' "$*"; }

# --- 1. piper in a user venv (Ubuntu 24.04 is PEP 668 managed: no system pip)
if [ -x "$VENV/bin/piper" ]; then
    say "· piper already installed ($VENV)"
else
    say "· installing piper into $VENV"
    mkdir -p "$(dirname "$VENV")"
    python3 -m venv "$VENV"
    "$VENV/bin/pip" -q install --upgrade pip
    "$VENV/bin/pip" -q install piper-tts
fi

# --- 2. voices (note: piper's own downloader dies on the non-ASCII pt name,
#        so these are fetched straight from Hugging Face with quoting)
mkdir -p "$VOICES"
for voice in "${WANT_VOICES[@]}"; do
    onnx="$VOICES/$voice.onnx"
    if [ -s "$onnx" ]; then
        say "· voice present: $voice"
        continue
    fi
    lang="${voice%%_*}"                    # en / pt
    rest="${voice#*_}"                     # US-lessac-medium
    locale="${rest%%-*}"                   # US
    tail="${rest#*-}"                      # lessac-medium
    speaker="${tail%-*}"                   # lessac
    quality="${tail##*-}"                  # medium
    base="https://huggingface.co/rhasspy/piper-voices/resolve/main"
    dir="$lang/${lang}_${locale}/${speaker}/${quality}"
    for ext in onnx onnx.json; do
        name="$voice.$ext"
        url="$base/$dir/$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$name")"
        say "· downloading $name"
        curl -sfL --retry 3 -o "$VOICES/$name" "$url"
    done
done

# --- 3. machine-local choices (never committed, per host)
if [ -f "$ENV_FILE" ]; then
    say "· choices already set: $ENV_FILE"
else
    mkdir -p "$(dirname "$ENV_FILE")"
    cat > "$ENV_FILE" <<'EOF'
# pi speech — machine-local. Not in the repo: each host may differ.
# PI_SPEECH_LANG=en            # en | pt
# PI_SPEECH_VOICE=en_US-lessac-medium
# PI_SPEECH_LENGTH_SCALE=1.0   # >1 = slower speech
# PI_SPEECH_ENGINE=auto        # auto | piper | espeak
PI_SPEECH_LANG=en
PI_SPEECH_LENGTH_SCALE=1.0
EOF
    say "· wrote $ENV_FILE"
fi

# --- 4. Telegram bridge wiring
if [ "$WIRE" = 1 ]; then
    if [ -f "$TELEGRAM_JSON" ]; then
        python3 - "$TELEGRAM_JSON" <<'PY'
import json, shutil, sys, time, pathlib
path = pathlib.Path(sys.argv[1])
cfg = json.loads(path.read_text())
template = "~/.pi/agent/scripts/speech/speak.sh -o {ogg}"
changed = False

handlers = [h for h in (cfg.get("outboundHandlers") or [])
            if not (isinstance(h, dict) and h.get("type") == "voice")]
current = next((h for h in (cfg.get("outboundHandlers") or [])
                if isinstance(h, dict) and h.get("type") == "voice"), None)
new = {"type": "voice", "template": template, "output": "{ogg}", "timeout": 120000}
if current != new:
    handlers.append(new)
    cfg["outboundHandlers"] = handlers
    changed = True

voice = cfg.get("voice") or {}
if voice.get("replyMode") != "always":
    voice["replyMode"] = "always"
    cfg["voice"] = voice
    changed = True

if changed:
    shutil.copy2(path, path.with_suffix(f".json.bak.{int(time.time())}"))
    path.write_text(json.dumps(cfg, indent=2) + "\n")
    print("· telegram.json wired (restart the agent to load it)")
else:
    print("· telegram.json already wired")
PY
    else
        say "· no telegram.json on this host — skipped bridge wiring"
    fi
fi

# --- 5. self-test: must produce a playable OGG
out="$(mktemp -d)/selftest.ogg"
printf 'Speech is ready on this host. This sentence was generated locally by Piper.' \
    | "$HERE/speak.sh" -o "$out" >/dev/null
dur="$(ffprobe -hide_banner -loglevel error -show_entries format=duration -of csv=p=0 "$out" 2>/dev/null || echo '?')"
size="$(stat -c %s "$out")"
say "· self-test ok: ${dur}s of audio, ${size} bytes Opus"
say "done."
