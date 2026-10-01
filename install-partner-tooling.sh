#!/usr/bin/env bash
set -euo pipefail
#
# install.sh — add partner-agent tooling + generic subagent capability to a fresh Pi.
# Idempotent: safe to re-run.

AGENT_DIR="$HOME/.pi/agent"
WORKSPACES="$HOME/.pi/partner-agents"
REPO="neopmpmtj/pi-workspace"

echo "==> Checking prerequisites"
for c in pi git; do
  command -v "$c" >/dev/null 2>&1 || { echo "ERROR: '$c' not found on PATH" >&2; exit 1; }
done
command -v gh >/dev/null 2>&1 || echo "    WARN: 'gh' not found — only needed later to create/push new partner agents."

echo "==> 1/6 Install subagent packages (generic capability; NO frontend/researcher definitions)"
pi install npm:pi-agents-pool
pi install npm:@mjakl/pi-subagent

echo "==> 2/6 Fetch partner-agent tooling from $REPO"
if [ -d "$AGENT_DIR/partner-agents" ] && [ -n "$(ls -A "$AGENT_DIR/partner-agents" 2>/dev/null)" ]; then
  echo "    existing tooling found; backing up to $AGENT_DIR/partner-agents.bak"
  rm -rf "$AGENT_DIR/partner-agents.bak"
  mv "$AGENT_DIR/partner-agents" "$AGENT_DIR/partner-agents.bak"
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone --depth 1 "https://github.com/$REPO.git" "$TMP/repo"
cp -R "$TMP/repo/agent/partner-agents" "$AGENT_DIR/partner-agents"
chmod +x "$AGENT_DIR/partner-agents/"*.sh 2>/dev/null || true
rm -rf "$TMP"

echo "==> 3/6 Create partner-agent workspaces folder"
mkdir -p "$WORKSPACES"
[ -f "$AGENT_DIR/partner-agents/partner-agents.list" ] || : > "$AGENT_DIR/partner-agents/partner-agents.list"

echo "==> 4/6 GitHub auth check (optional for install; needed later to create/push partners)"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh auth status
else
  echo "    WARN: gh not authenticated — installs fine, but 'gh repo create' in setup-pi-agent.sh will fail until you run 'gh auth login'."
fi

echo "==> 5/6 Write standing rules"
cat > "$AGENT_DIR/partner-agents/REMEMBER.md" <<'EOF'
# Partner-agent standing rules

1. DEFAULT MODEL — when creating any partner agent (via setup-pi-agent.sh),
   default its model to `deepseek-flash` unless the user says otherwise.

2. FRONTEND WILL BECOME A PARTNER AGENT (later) — do NOT recreate frontend as a
   subagent. When the frontend partner agent is created, transfer its knowledge:
   role = front-end specialist (HTML/CSS/JS/UI), read-only on backend, clear
   reporting protocol (what / why / state / next steps), and point it at THIS
   machine's website project path. The source of that knowledge (frontend.md)
   will be provided at creation time.

3. SECRETS — all API keys/tokens/passwords live in ~/.pi/agent/.env and are
   referenced as $VAR (never inlined in config or git). Partner agents symlink
   auth.json + models-store.json to ~/.pi/agent/ and git-ignore .env.
EOF

echo "==> 6/6 Confirm packages"
pi list

echo
echo "Done. Restart Pi, then confirm:"
echo "  - pi list shows npm:pi-agents-pool and npm:@mjakl/pi-subagent"
echo "  - ~/.pi/agent/partner-agents/ contains setup-pi-agent.sh, push-partner-agents.sh, shared/"
echo "  - ~/.pi/partner-agents/ exists (empty)"
echo "  - gh auth status shows neopmpmtj (optional — needed only to create/push new partners)"
