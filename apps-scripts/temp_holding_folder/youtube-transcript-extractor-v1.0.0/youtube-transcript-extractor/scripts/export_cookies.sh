#!/usr/bin/env bash
# export_cookies.sh — Export YouTube cookies from Firefox for yt-dlp auth
#
# Usage: bash scripts/export_cookies.sh
#
# Prerequisites:
#   1. Firefox must be installed and closed (or use a Firefox profile dir)
#   2. You must be logged into YouTube in Firefox as neopmpmtj@gmail.com
#
# Output: cookies.txt in the skill root directory
#
# Alternative (if Firefox is not installed):
#   Use the "cookies.txt" Firefox extension to export manually:
#   1. Install: https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/
#   2. Visit youtube.com, click the extension, export → save as cookies.txt

set -euo pipefail

SKILL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="$SKILL_ROOT/cookies.txt"

echo "🔑 YouTube Cookie Exporter"
echo "=========================="
echo ""

# Check if Firefox is available
if command -v firefox &>/dev/null; then
    echo "✅ Firefox found"
    echo ""
    echo "📋 Make sure you are logged into YouTube in Firefox as neopmpmtj@gmail.com"
    echo "   If you haven't logged in yet:"
    echo "   1. Open Firefox → go to youtube.com → sign in as neopmpmtj@gmail.com"
    echo "   2. Close Firefox completely"
    echo ""
    echo "⚠️  IMPORTANT: Close Firefox before continuing (Firefox locks the cookie DB)"
    echo ""
    read -r -p "Press Enter when Firefox is closed and you're ready to export..." _

    echo "🍪 Extracting cookies from Firefox..."

    # Find Firefox profile directory
    FIREFOX_PROFILE=$(find "$HOME/.mozilla/firefox" -maxdepth 2 -name "cookies.sqlite" 2>/dev/null | head -1 | xargs dirname 2>/dev/null || echo "")

    if [ -z "$FIREFOX_PROFILE" ]; then
        echo "⚠️  Could not auto-detect Firefox profile."
        echo "   Trying snap Firefox path..."
        FIREFOX_PROFILE=$(find "$HOME/snap/firefox/common/.mozilla/firefox" -maxdepth 2 -name "cookies.sqlite" 2>/dev/null | head -1 | xargs dirname 2>/dev/null || echo "")
    fi

    if [ -n "$FIREFOX_PROFILE" ]; then
        echo "   Profile: $FIREFOX_PROFILE"

        # Use Python to extract YouTube cookies from the Firefox cookie database
        python3 - "$FIREFOX_PROFILE" "$OUTPUT" << 'PYEOF'
import sys
import sqlite3
import os
from pathlib import Path

profile_dir = sys.argv[1]
output_path = sys.argv[2]

db_path = os.path.join(profile_dir, "cookies.sqlite")
if not os.path.exists(db_path):
    print(f"ERROR: cookies.sqlite not found at {db_path}")
    sys.exit(1)

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Get YouTube and Google cookies
    cursor.execute("""
        SELECT host, name, value, path, expiry, isSecure, isHttpOnly
        FROM moz_cookies
        WHERE host LIKE '%.youtube.com' OR host LIKE '%.google.com'
        ORDER BY host
    """)
    
    rows = cursor.fetchall()
    conn.close()
    
    if not rows:
        print("ERROR: No YouTube/Google cookies found. Are you logged in?")
        sys.exit(1)
    
    with open(output_path, 'w') as f:
        f.write("# Netscape HTTP Cookie File\n")
        f.write("# Exported by export_cookies.sh\n")
        f.write("# https://curl.haxx.se/rfc/cookie_spec.html\n")
        f.write("# This is a generated file! Do not edit.\n\n")
        
        for host, name, value, path, expiry, is_secure, is_http_only in rows:
            domain = host if host.startswith('.') else f'.{host}'
            flag = 'TRUE' if host.startswith('.') else 'FALSE'
            secure = 'TRUE' if is_secure else 'FALSE'
            expiry_val = str(int(expiry)) if expiry else '0'
            
            f.write(f"{domain}\t{flag}\t{path}\t{secure}\t{expiry_val}\t{name}\t{value}\n")
    
    print(f"✅ Exported {len(rows)} cookies to {output_path}")
    print(f"\n📌 Set this env var to use them:")
    print(f"   export YOUTUBE_COOKIES_FILE={output_path}")

except Exception as e:
    print(f"ERROR: {e}")
    sys.exit(1)
PYEOF
    else
        echo "❌ Cannot find Firefox profile directory."
        echo ""
        echo "📋 Manual alternative:"
        echo "   1. Install the 'cookies.txt' Firefox extension"
        echo "   2. Visit youtube.com → click the extension → Export"
        echo "   3. Save as: $OUTPUT"
        exit 1
    fi
else
    echo "⚠️  Firefox not found in PATH."
    echo ""
    echo "📋 Manual alternative:"
    echo "   1. Install Firefox: sudo apt install firefox  (or snap install firefox)"
    echo "   2. Log into YouTube as neopmpmtj@gmail.com"
    echo "   3. Re-run this script"
    echo ""
    echo "   Or use the 'cookies.txt' browser extension to export manually."
    exit 1
fi

echo ""
echo "🍪 Done! cookies.txt is ready."
echo ""
echo "📌 To use, set the env var before running:"
echo "   export YOUTUBE_COOKIES_FILE=$OUTPUT"
echo ""
echo "   Or run the transcript extractor — it auto-detects cookies.txt in the skill root."
