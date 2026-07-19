#!/usr/bin/env bash
# fetch-metadata.sh — Extract YouTube video metadata via yt-dlp
# Usage: ./fetch-metadata.sh <youtube-url>
# Output: JSON object with title, description, duration, channel, upload_date, view_count, like_count, categories, tags

set -euo pipefail

if [ $# -lt 1 ]; then
  echo '{"error": "Usage: fetch-metadata.sh <youtube-url>"}' >&2
  exit 1
fi

URL="$1"

# Check if yt-dlp is available
if ! command -v yt-dlp &>/dev/null; then
  echo '{"error": "yt-dlp is not installed. Install it via: pip install yt-dlp  or  brew install yt-dlp"}' >&2
  exit 2
fi

# Fetch metadata as JSON
yt-dlp \
  --dump-json \
  --no-playlist \
  --no-download \
  --ignore-errors \
  --no-warnings \
  "$URL" 2>/dev/null | python3 -c "
import json, sys

try:
    data = json.load(sys.stdin)
except json.JSONDecodeError:
    print(json.dumps({'error': 'Failed to parse video metadata. Invalid URL or video unavailable.'}))
    sys.exit(1)

# Extract only the fields we care about
out = {
    'id': data.get('id', ''),
    'title': data.get('title', ''),
    'description': data.get('description', '')[:500],  # Truncate long descriptions
    'duration': data.get('duration', 0),                # seconds
    'duration_minutes': round(data.get('duration', 0) / 60, 1),
    'channel': data.get('channel', '') or data.get('uploader', ''),
    'channel_url': data.get('channel_url', '') or data.get('uploader_url', ''),
    'upload_date': data.get('upload_date', ''),
    'view_count': data.get('view_count', 0),
    'like_count': data.get('like_count', 0),
    'categories': data.get('categories', []),
    'tags': data.get('tags', [])[:20],                  # Truncate long tag lists
    'webpage_url': data.get('webpage_url', '$URL'),
    'thumbnail': data.get('thumbnail', ''),
}
print(json.dumps(out, indent=2, ensure_ascii=False))
"