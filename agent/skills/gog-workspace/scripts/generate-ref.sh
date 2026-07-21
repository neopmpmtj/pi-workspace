#!/usr/bin/env bash
# Auto-generate references/quickref.md from live `gog <service> --help` output.
# Run after any gog update:  bash scripts/generate-ref.sh
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$SKILL_DIR/references/quickref.md"
VERSION=$(gog --version 2>&1 | head -1)
DATE=$(date +%Y-%m-%d)

SERVICES="drive gmail calendar contacts sheets docs"

# Extract commands section: everything between "Commands:" and next top-level "Flags:" / EOF
extract_commands() {
  local help_text="$1"
  echo "$help_text" \
    | sed -n '/^Commands:/,/^Flags:/p' \
    | sed '1d;$d' \
    | sed '/^$/d' \
    | sed '/^[A-Za-z]/d'   # remove subsection headers like "Read", "Write", "Send & Reply"
}

{
  echo "# GOG Workspace — Auto-Generated Command Reference"
  echo ""
  echo "> **Generated:** $DATE | **gog:** $VERSION"
  echo "> **Source of truth:** the live CLI. Run \`scripts/generate-ref.sh\` after any \`gog\` update."
  echo "> **At runtime:** always prefer \`gog <service> --help\` over this cached file."
  echo ""

  for svc in $SERVICES; do
    HELP=$(gog "$svc" --help 2>&1 || true)
    CMDS=$(extract_commands "$HELP")

    if [ -z "$CMDS" ]; then
      continue
    fi

    echo "## gog $svc"
    echo ""

    while IFS= read -r line; do
      echo "$line"
    done <<< "$CMDS"

    echo ""
  done

  echo "## Troubleshooting"
  echo ""
  echo "- **\`gog: command not found\`**: \`brew install steipete/tap/gogcli\`"
  echo "- **\`authentication required\`**: \`gog auth list\` then \`gog auth login <email>\`"
  echo "- **keyring prompts**: set \`GOG_KEYRING_PASSWORD\` in \`~/.pi/agent/.env\`"

} > "$OUT"

echo "✅ Generated: $OUT  ($VERSION, $DATE)"
