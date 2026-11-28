#!/usr/bin/env bash
# ============================================================
# gpu-image.sh — make an image on the home server's RTX 3060.
#
#   gpu-image.sh "a lighthouse on a cliff at dusk, photograph"
#   gpu-image.sh --mode quick "a fox"
#   gpu-image.sh --mode max --size 1200 "a bee"
#   gpu-image.sh --from ~/Pictures/bee.png --denoise 0.45 "its wings are now blue"
#   gpu-image.sh --reference ~/Pictures/x.png "same subject, new pose or scene"
#
# Modes (the mode picks model, render size, steps, cfg):
#   quick   SDXL-Turbo                       1024²   4 steps   ~3 s
#   medium  Qwen-Image-2.1 base int8  ←default 1024²  20 steps  ~90 s
#   max     Qwen-Image-2.1 base int8         2048²  30 steps  ~9 min
#
# --size N asks for an N x N deliverable. If N is smaller than the mode's render
# size the image is rendered at the mode size and downsampled (crisp); if N is
# larger, it is rendered at N.
#
# Prints the PNG path on stdout and one machine line on stderr:
#   gpu-image: mode=medium model=base render=1024 output=1024 time=91.2s seed=1234 path=/tmp/x.png
# Every run is appended to ~/.pi/agent/logs/image-runs.jsonl (per host, free).
#
# Exit: 0 image written | 1 usage | 2 server unreachable or generation failed
# Skill: agent/skills/image-gen/SKILL.md
# ============================================================
set -euo pipefail

HOST="${GPU_IMAGE_HOST:-desktop}"
REMOTE_PY="${GPU_IMAGE_PY:-/home/pmpmt/venvs/comfy/bin/python}"
REMOTE_GEN="${GPU_IMAGE_GEN:-/home/pmpmt/ComfyUI/gen.py}"
LOG="${GPU_IMAGE_LOG:-$HOME/.pi/agent/logs/image-runs.jsonl}"

MODE="medium"
OUT=""
REQ_SIZE=""
STEPS_OVERRIDE=""
CFG_OVERRIDE=""
SEED=""
NEG="blurry, low quality, watermark, text"
FROM=""
REFERENCE=""
DENOISE="0.45"
PROMPT=""

while [ $# -gt 0 ]; do
    case "$1" in
        --mode) MODE="$2"; shift 2 ;;
        --out) OUT="$2"; shift 2 ;;
        --size | --exact) REQ_SIZE="$2"; shift 2 ;;
        --steps) STEPS_OVERRIDE="$2"; shift 2 ;;
        --cfg) CFG_OVERRIDE="$2"; shift 2 ;;
        --seed) SEED="$2"; shift 2 ;;
        --negative) NEG="$2"; shift 2 ;;
        --from) FROM="$2"; shift 2 ;;
        --reference) REFERENCE="$2"; shift 2 ;;
        --denoise) DENOISE="$2"; shift 2 ;;
        -h | --help) sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        -) PROMPT="$(cat)"; shift ;;
        -*) echo "gpu-image.sh: unknown flag $1" >&2; exit 1 ;;
        *) PROMPT="$*"; break ;;
    esac
done

case "$MODE" in
    quick) MODEL="sdxl"; RENDER=1024; STEPS=4; CFG=1.0 ;;
    medium) MODEL="base"; RENDER=1024; STEPS=20; CFG=3.5 ;;
    max) MODEL="base"; RENDER=2048; STEPS=30; CFG=3.5 ;;
    *) echo "gpu-image.sh: --mode must be quick, medium or max" >&2; exit 1 ;;
esac
[ -n "$STEPS_OVERRIDE" ] && STEPS="$STEPS_OVERRIDE"
[ -n "$CFG_OVERRIDE" ] && CFG="$CFG_OVERRIDE"

case "${REQ_SIZE:-0}${SEED:-0}$STEPS$CFG" in
    *[!0-9.]*) echo "gpu-image.sh: size/seed/steps/cfg must be numeric" >&2; exit 1 ;;
esac

remote_from=""
if [ -n "$REFERENCE" ]; then FROM="" ; fi
if [ -n "$REFERENCE" ]; then
    [ -f "$REFERENCE" ] || { echo "gpu-image.sh: --reference file not found: $REFERENCE" >&2; exit 2; }
    remote_from="ref-$(date +%s)-$$.png"
    timeout 120 scp -q -o BatchMode=yes "$REFERENCE" "$HOST:ComfyUI/input/$remote_from" || {
        echo "gpu-image.sh: could not upload $REFERENCE" >&2; exit 2; }
    RENDER="$(python3 -c "import sys; from PIL import Image; w,h=Image.open(sys.argv[1]).size; print(max(w,h))" "$REFERENCE")"
fi
if [ -n "$FROM" ]; then
    [ -f "$FROM" ] || { echo "gpu-image.sh: --from file not found: $FROM" >&2; exit 2; }
    remote_from="edit-$(date +%s)-$$.png"
    if ! timeout 120 scp -q -o BatchMode=yes "$FROM" "$HOST:ComfyUI/input/$remote_from"; then
        echo "gpu-image.sh: could not upload $FROM to $HOST" >&2; exit 2
    fi
    if ! python3 -c "import sys; from PIL import Image; w,h=Image.open(sys.argv[1]).size; print(max(w,h))" "$FROM" >/dev/null; then
        echo "gpu-image.sh: $FROM is not a readable image" >&2; exit 2
    fi
fi
if [ -n "$REQ_SIZE" ] && [ "$REQ_SIZE" -gt "$RENDER" ]; then RENDER="$REQ_SIZE"; fi
[ -n "$PROMPT" ] || { echo "gpu-image.sh: empty prompt" >&2; exit 2; }
OUT="${OUT:-/tmp/pi-image-$(date +%s).png}"

remote_out="/tmp/gpu-$(date +%s)-$$.png"
args="--out $remote_out --size $RENDER --steps $STEPS --cfg $CFG --model $MODEL --negative $(printf '%q' "$NEG")"
if [ -n "$REFERENCE" ]; then
    args="$args --edit $remote_from --size $RENDER"
elif [ -n "$remote_from" ]; then
    args="$args --from $remote_from --denoise $DENOISE"
    RENDER="$(python3 -c "import sys; from PIL import Image; w,h=Image.open(sys.argv[1]).size; print(max(w,h))" "$FROM")"
    args="$args --size $RENDER"
fi
[ -n "$SEED" ] && args="$args --seed $SEED"

mkdir -p "$(dirname "$OUT")"
resp=""
if ! resp="$(printf '%s' "$PROMPT" | timeout 1800 ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" \
        "$REMOTE_PY $REMOTE_GEN $args" 2>&1)"; then
    echo "gpu-image.sh: generation failed on $HOST — $(printf '%s' "$resp" | tail -n 1)" >&2
    exit 2
fi
meta="$(printf '%s\n' "$resp" | grep -E '^seed=[0-9]+ time=' | tail -n 1 || true)"
secs="$(printf '%s' "$meta" | sed -n 's/.*time=\([0-9.]*\)s.*/\1/p')"
seed="$(printf '%s' "$meta" | sed -n 's/.*seed=\([0-9]*\).*/\1/p')"

if ! timeout 300 rsync -q -e "ssh -o BatchMode=yes" "$HOST:$remote_out" "$OUT"; then
    echo "gpu-image.sh: generated but could not copy $remote_out back" >&2
    exit 2
fi
timeout 30 ssh -o BatchMode=yes "$HOST" "rm -f $remote_out $([[ -n "$remote_from" ]] && echo "ComfyUI/input/$remote_from")" 2>/dev/null || true

OUT_PX="$RENDER"
if [ -n "$REQ_SIZE" ] && [ "$REQ_SIZE" -ne "$RENDER" ]; then
    python3 - "$OUT" "$REQ_SIZE" <<'PYPIX'
import sys
from PIL import Image
path, px = sys.argv[1], int(sys.argv[2])
im = Image.open(path).convert("RGB").resize((px, px), Image.LANCZOS)
im.save(path, "PNG", optimize=True)
PYPIX
    OUT_PX="$REQ_SIZE"
fi

mkdir -p "$(dirname "$LOG")"
MODE_LABEL="$MODE"; [ -n "$FROM" ] && MODE_LABEL="edit:$MODE"
DENOISE_FIELD="null"; [ -n "$FROM" ] && DENOISE_FIELD="$DENOISE"
printf '{"ts":"%s","mode":"%s","model":"%s","render":%s,"output":%s,"steps":%s,"cfg":%s,"denoise":%s,"source":"%s","seconds":%s,"seed":%s,"path":"%s"}\n' \
    "$(date -Is)" "$MODE_LABEL" "$MODEL" "$RENDER" "$OUT_PX" "$STEPS" "$CFG" \
    "$DENOISE_FIELD" "$FROM" "${secs:-null}" "${seed:-null}" "$OUT" >>"$LOG"

printf 'gpu-image: mode=%s model=%s render=%s output=%s time=%ss seed=%s path=%s\n' \
    "$MODE_LABEL" "$MODEL" "$RENDER" "$OUT_PX" "${secs:-?}" "${seed:-?}" "$OUT" >&2
printf '%s\n' "$OUT"
