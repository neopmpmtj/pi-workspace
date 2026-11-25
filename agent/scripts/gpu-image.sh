#!/usr/bin/env bash
# ============================================================
# gpu-image.sh — make an image on the home server's RTX 3060.
#
#   gpu-image.sh "a lighthouse on a cliff at dusk, photograph"
#   gpu-image.sh --out ~/Pictures/fox.png "a red fox in snow"
#   gpu-image.sh --size 1024 --steps 8 --seed 42 "prompt"
#   gpu-image.sh --exact 600 "prompt"        # render 1024, deliver exactly 600x600
#
# The prompt is read from the first positional argument (or stdin with -).
# Rendering runs on the home server (192.168.1.60) through its local ComfyUI
# service (127.0.0.1:8188) with Qwen-Image-2.1 turbo int8: ~10 s per 1024^2
# image on the 3060, free and local. The PNG is copied back to --out
# (default: /tmp/pi-image-<epoch>.png) and that path is printed on stdout.
#
# Exit: 0 image written | 1 usage | 2 server unreachable or generation failed
#
# Runbook: agent/docs/runbooks/lan-server-192.168.1.60/comfyui-image-generation.md
# ============================================================
set -euo pipefail

HOST="${GPU_IMAGE_HOST:-desktop}"
REMOTE_PY="${GPU_IMAGE_PY:-/home/pmpmt/venvs/comfy/bin/python}"
REMOTE_GEN="${GPU_IMAGE_GEN:-/home/pmpmt/ComfyUI/gen.py}"

OUT="/tmp/pi-image-$(date +%s).png"
SIZE=1024
STEPS=8
SEED=""
CFG=1.0
NEG="blurry, low quality, watermark, text"
EXACT=""
PROMPT=""

while [ $# -gt 0 ]; do
    case "$1" in
        --out) OUT="$2"; shift 2 ;;
        --size) SIZE="$2"; shift 2 ;;
        --steps) STEPS="$2"; shift 2 ;;
        --seed) SEED="$2"; shift 2 ;;
        --cfg) CFG="$2"; shift 2 ;;
        --negative) NEG="$2"; shift 2 ;;
        --exact) EXACT="$2"; shift 2 ;;
        -h | --help) sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        -) PROMPT="$(cat)"; shift ;;
        -*) echo "gpu-image.sh: unknown flag $1" >&2; exit 1 ;;
        *) PROMPT="$*"; break ;;
    esac
done

case "$EXACT" in [0-9]*) ;; "") ;; *) echo "gpu-image.sh: --exact takes pixels (e.g. 600)" >&2; exit 1 ;; esac
case "$SIZE$STEPS$CFG${SEED:-0}" in
    *[!0-9.]*) echo "gpu-image.sh: --size/--steps/--cfg/--seed must be numeric" >&2; exit 1 ;;
esac
[ -n "$PROMPT" ] || { echo "gpu-image.sh: empty prompt" >&2; exit 2; }

remote_out="/tmp/gpu-$(date +%s)-$$.png"
args="--out $remote_out --size $SIZE --steps $STEPS --cfg $CFG --negative $(printf '%q' "$NEG")"
[ -n "$SEED" ] && args="$args --seed $SEED"

mkdir -p "$(dirname "$OUT")"
if ! printf '%s' "$PROMPT" | timeout 900 ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" \
        "$REMOTE_PY $REMOTE_GEN $args" >/dev/null; then
    echo "gpu-image.sh: generation failed on $HOST (ComfyUI down, model missing, or prompt rejected)" >&2
    exit 2
fi

if ! timeout 300 rsync -q -e "ssh -o BatchMode=yes" "$HOST:$remote_out" "$OUT"; then
    echo "gpu-image.sh: generated but could not copy $remote_out back" >&2
    exit 2
fi
timeout 30 ssh -o BatchMode=yes "$HOST" "rm -f $remote_out" 2>/dev/null || true

if [ -n "$EXACT" ]; then
    python3 - "$OUT" "$EXACT" <<'PYPIX'
import sys
from PIL import Image
path, px = sys.argv[1], int(sys.argv[2])
im = Image.open(path).convert("RGB").resize((px, px), Image.LANCZOS)
im.save(path, "PNG", optimize=True)
print(f"{path} resized to {px}x{px}", file=sys.stderr)
PYPIX
fi

printf '%s\n' "$OUT"
