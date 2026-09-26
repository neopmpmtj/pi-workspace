#!/usr/bin/env bash
# push-partner-agents.sh — commit + push every registered partner agent.
#
# Reads ~/.pi/agent/partner-agents/partner-agents.list (one absolute
# workspace path per line). For each entry that is a git repo, stages all
# changes, commits (if anything staged), and pushes origin main.
#
# This is the single command that keeps ALL partner agents backed up:
#     ~/.pi/agent/partner-agents/push-partner-agents.sh

LIST="$HOME/.pi/agent/partner-agents/partner-agents.list"

if [ ! -f "$LIST" ]; then
    echo "Registry not found: $LIST"
    exit 1
fi

while IFS= read -r dir; do
    # skip empty lines and comments
    [ -z "$dir" ] && continue
    case "$dir" in \#*) continue ;; esac

    if [ ! -d "$dir/.git" ]; then
        echo "SKIP (not a git repo): $dir"
        continue
    fi

    echo "=== $dir ==="
    git -C "$dir" add -A
    if git -C "$dir" diff --cached --quiet; then
        echo "  (no changes)"
    else
        git -C "$dir" commit -q -m "chore: sync partner agent" && echo "  committed"
    fi
    if git -C "$dir" push origin main 2>&1 | tail -1; then
        echo "  pushed"
    else
        echo "  PUSH FAILED — check remote for $dir"
    fi
done < "$LIST"

echo ""
echo "Done. All registered partner agents are synced."
