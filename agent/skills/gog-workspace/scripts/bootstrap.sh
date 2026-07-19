#!/usr/bin/env bash
# bootstrap.sh — Install gog CLI and set up Google OAuth for the gog-workspace skill.
#
# Usage: bash scripts/bootstrap.sh
#
# What this does:
#   1. Installs gog CLI (Homebrew or manual download)
#   2. Guides you through Google Cloud Console OAuth setup
#   3. Configures gog auth with your credentials
#   4. Sets up the file-based keyring for token storage

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_step() { echo -e "${BLUE}▶${NC} $1"; }
print_ok()   { echo -e "${GREEN}✅${NC} $1"; }
print_warn() { echo -e "${YELLOW}⚠️${NC}  $1"; }
print_err()  { echo -e "${RED}❌${NC} $1"; }

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  GOG Workspace — Bootstrap Installer     ║"
echo "║  Google Suite for AI Agents              ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Step 1: Check/install gog CLI ──────────────────────────────────────────

print_step "Checking for gog CLI..."

if command -v gog &>/dev/null; then
    GOG_VERSION=$(gog --version 2>&1 | head -1 || echo "unknown")
    print_ok "gog already installed: $GOG_VERSION"
else
    print_warn "gog not found. Installing..."

    if command -v brew &>/dev/null; then
        echo "   Using Homebrew..."
        brew install steipete/tap/gogcli
        print_ok "gog installed via Homebrew"
    else
        echo ""
        echo "   Homebrew not found. Options:"
        echo ""
        echo "   1. Install Homebrew: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        echo "      Then run: brew install steipete/tap/gogcli"
        echo ""
        echo "   2. Download gog binary directly from:"
        echo "      https://github.com/steipete/gogcli/releases"
        echo ""
        echo "   After installing manually, re-run this script."
        exit 1
    fi
fi

echo ""

# ── Step 2: Google Cloud Console OAuth Setup ────────────────────────────────

print_step "Google Cloud Console OAuth Setup"

CLIENT_SECRET=""
# Check common locations for existing client_secret.json
for path in \
    "$HOME/Downloads/client_secret.json" \
    "$HOME/Downloads/client_secret_*.json" \
    "$(dirname "$0")/../client_secret.json" \
    "$HOME/.config/gogcli/client_secret.json"; do
    # Expand glob if present
    for f in $path; do
        if [ -f "$f" ]; then
            CLIENT_SECRET="$f"
            break 2
        fi
    done
done

if [ -n "$CLIENT_SECRET" ]; then
    print_ok "Found client_secret.json at: $CLIENT_SECRET"
else
    echo ""
    echo "   You need a Google Cloud Console OAuth 2.0 Client ID."
    echo "   Here's how to get one:"
    echo ""
    echo "   ┌─────────────────────────────────────────────────────────┐"
    echo "   │ 1. Go to: https://console.cloud.google.com/apis/credentials │"
    echo "   │ 2. Create a project (or select existing)                    │"
    echo "   │ 3. Click '+ CREATE CREDENTIALS' → 'OAuth client ID'        │"
    echo "   │ 4. Application type: 'Desktop app'                         │"
    echo "   │ 5. Name it (e.g. 'My AI Agent')                            │"
    echo "   │ 6. Click 'CREATE' → download the JSON file                 │"
    echo "   │ 7. Save it as 'client_secret.json'                         │"
    echo "   └─────────────────────────────────────────────────────────┘"
    echo ""
    echo "   After downloading, place the file at:"
    echo "   $HOME/Downloads/client_secret.json"
    echo ""
    read -r -p "   Press Enter once you've downloaded client_secret.json..." _

    for path in "$HOME/Downloads/client_secret.json" "$(dirname "$0")/../client_secret.json"; do
        if [ -f "$path" ]; then
            CLIENT_SECRET="$path"
            break
        fi
    done

    if [ -z "$CLIENT_SECRET" ]; then
        print_err "client_secret.json not found. Please download it and re-run this script."
        exit 1
    fi
fi

echo ""

# ── Step 3: Configure gog auth ─────────────────────────────────────────────

print_step "Configuring gog authentication..."

# Register credentials
gog auth credentials "$CLIENT_SECRET"
print_ok "Credentials registered"

echo ""
echo "   Now add your Google account. Which email will you use?"
echo ""
read -r -p "   Email (e.g. neopmpmtj@gmail.com): " GOG_EMAIL

if [ -z "$GOG_EMAIL" ]; then
    print_err "Email is required."
    exit 1
fi

echo ""
echo "   A browser window will open. Sign in with: $GOG_EMAIL"
echo "   Grant all requested permissions when prompted."
echo ""

gog auth add "$GOG_EMAIL" --services gmail,calendar,drive,contacts,docs,sheets

print_ok "Account authenticated: $GOG_EMAIL"

echo ""

# ── Step 4: Set up keyring ─────────────────────────────────────────────────

print_step "Setting up keyring..."

gog auth keyring file

echo ""
echo "   You'll be asked to set a keyring password."
echo "   Save this password — you'll need it in your .env file."
echo ""

print_ok "Keyring configured (file-based)"

echo ""

# ── Step 5: Environment variables ──────────────────────────────────────────

print_step "Environment Variables"

ENV_FILE="$HOME/.openclaw/.env"
if [ ! -f "$ENV_FILE" ]; then
    ENV_FILE="$HOME/.env"
fi

echo ""
echo "   Add these to your .env file ($ENV_FILE):"
echo ""
echo -e "   ${YELLOW}GOG_ACCOUNT=$GOG_EMAIL${NC}"
echo -e "   ${YELLOW}GOG_KEYRING_PASSWORD=<the password you just set>${NC}"
echo ""

read -r -p "   Would you like me to append these to $ENV_FILE? (y/n) " ADD_ENV

if [ "$ADD_ENV" = "y" ] || [ "$ADD_ENV" = "Y" ]; then
    # Don't duplicate if already present
    if ! grep -q "^GOG_ACCOUNT=" "$ENV_FILE" 2>/dev/null; then
        echo "GOG_ACCOUNT=$GOG_EMAIL" >> "$ENV_FILE"
    fi
    if ! grep -q "^GOG_KEYRING_PASSWORD=" "$ENV_FILE" 2>/dev/null; then
        read -r -s -p "   Enter your keyring password: " KEYRING_PW
        echo ""
        echo "GOG_KEYRING_PASSWORD=$KEYRING_PW" >> "$ENV_FILE"
    fi
    print_ok "Environment variables added to $ENV_FILE"
else
    echo "   Skipped. Add them manually when ready."
fi

echo ""

# ── Step 6: Verify ─────────────────────────────────────────────────────────

print_step "Verifying setup..."

if gog auth list --json 2>/dev/null | grep -q "$GOG_EMAIL"; then
    print_ok "Authentication verified"
else
    print_warn "Auth verification failed. Check: gog auth list"
fi

# Test Gmail access
if gog gmail messages search "in:inbox" --max 1 --json &>/dev/null; then
    print_ok "Gmail access verified"
else
    print_warn "Gmail test failed. Check your credentials and network."
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  ✅ GOG Workspace setup complete!        ║"
echo "║                                          ║"
echo "║  Account: $GOG_EMAIL"
echo "║  Services: Gmail, Calendar, Drive,       ║"
echo "║            Contacts, Sheets, Docs        ║"
echo "║                                          ║"
echo "║  Try it: gog gmail search \"is:unread\"   ║"
echo "╚══════════════════════════════════════════╝"
echo ""
