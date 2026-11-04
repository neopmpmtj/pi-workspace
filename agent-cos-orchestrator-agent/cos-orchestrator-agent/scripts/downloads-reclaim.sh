#!/usr/bin/env bash
# downloads-reclaim.sh — reclaim the space identified in
# docs/inventory/2026-11-03-downloads-pmpmt.md (section "Cleanup candidates").
#
#   ./downloads-reclaim.sh [--apply] [host]
#
# Default is a DRY RUN: prints exactly what would be removed, frees nothing.
# --apply deletes permanently (no trash on the remote host) and then reports
# before/after free space.
set -euo pipefail

APPLY=0
HOST=lan-pmpmt
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    -*) echo "unknown flag: $a" >&2; exit 1 ;;
    *) HOST="$a" ;;
  esac
done

DL='"$HOME/Downloads"'

# The list is explicit on purpose: no glob that could catch a current build.
read -r -d '' REMOTE <<EOF || true
set -u
DL="$DL"
FILES="\$(cd "\$DL" && ls -1 \
  '#Arquive_Downloads'/cursor_[0-9]*_amd64.deb \
  '#Arquive_Downloads'/Cursor-[0-9]*-x86_64.AppImage \
  '#Arquive_Downloads'/docker-desktop-amd64.deb \
  '#Arquive_Downloads'/docs-main.zip \
  '#Arquive_Downloads'/discord-0.0.134.deb \
  '#Arquive_Downloads'/google-chrome-stable_current_amd64.deb \
  '#Arquive_Downloads'/IMG_0444.webp \
  IMG_0444.png IMG_0444.jpg 2>/dev/null)"
[ -z "\$FILES" ] && { echo "nothing to remove"; exit 0; }

echo "-- free before: \$(df -h /home | awk 'NR==2{print \$4}')"
echo "-- bytes to free:"
printf '%s' "\$FILES" | sed "s|^|\$DL/|" | tr '\n' '\0' | xargs -0 du -cb 2>/dev/null | tail -1
echo "-- candidates:"
echo "\$FILES" | sed 's/^/   /'
echo "-- count: \$(echo "\$FILES" | wc -l) files"

# never touch these, even if a glob ever widens
for f in "\$FILES"; do
  case "\$f" in
    *cursor_3.7.36_amd64.deb|*cursor-sandbox-apparmor.deb) echo "REFUSING: \$f" >&2; exit 9 ;;
  esac
done

if [ "$APPLY" = 1 ]; then
  echo "\$FILES" | while IFS= read -r f; do rm -f -- "\$DL/\$f" && echo "removed: \$f"; done
  echo "-- free after: \$(df -h /home | awk 'NR==2{print \$4}')"
else
  echo "-- DRY RUN: nothing deleted (re-run with --apply)"
fi
EOF

ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST" "bash -s" <<<"$REMOTE"
