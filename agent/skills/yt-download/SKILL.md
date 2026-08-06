---
name: yt-download
description: Downloads YouTube videos for offline viewing using yt-dlp. No API keys, subscriptions, or logins required. Use when asked to download a YouTube video, save a YouTube video, or get a video for offline watching. Supports quality selection (best, 1080p, 720p, 480p, 360p, audio-only MP3).
---

# YouTube Video Download Skill

Download YouTube videos locally for offline viewing. No API keys, no subscriptions, no logins required.

## Primary Tool: yt-download script

A wrapper script at `~/.local/bin/yt-download` that handles format selection, merging, and output.

```bash
yt-download "<youtube_url>" [quality]
```

**Quality options** (default: `best`):
- `best` — Best video + best audio, merged to MP4
- `1080` — Up to 1080p
- `720` — Up to 720p
- `480` — Up to 480p
- `360` — Up to 360p
- `audio` — Audio only, extracted to MP3

**Output**: Always saved to `~/Videos/`.

**Examples**:
```bash
yt-download "https://www.youtube.com/watch?v=u5h2OCcKYkc"
yt-download "https://www.youtube.com/watch?v=u5h2OCcKYkc" 720
yt-download "https://www.youtube.com/watch?v=u5h2OCcKYkc" audio
```

## Fallback: Raw yt-dlp

If the script fails, use yt-dlp directly:

```bash
# Best quality (auto-merge video + audio to MP4)
yt-dlp -f "bestvideo+bestaudio/best" --merge-output-format mp4 \
  -o "~/Videos/%(title)s.%(ext)s" "<youtube_url>"

# Audio only as MP3
yt-dlp -f bestaudio -x --audio-format mp3 \
  -o "~/Videos/%(title)s.%(ext)s" "<youtube_url>"

# List available formats (useful for debugging)
yt-dlp --list-formats "<youtube_url>"
```

## Troubleshooting

### JS runtime warning
```
WARNING: [youtube] No supported JavaScript runtime could be found
```
YouTube deprecates extraction without a JS runtime, but the android VR API fallback still works. If formats are missing, install deno:
```bash
# Install deno (one-time)
curl -fsSL https://deno.land/install.sh | sh
# Then use:
yt-dlp --js-runtimes deno -f "bestvideo+bestaudio/best" --merge-output-format mp4 \
  -o "~/Videos/%(title)s.%(ext)s" "<url>"
```

### yt-dlp is outdated
YouTube changes frequently. If downloads fail, update:
```bash
yt-dlp -U
```
Or reinstall:
```bash
pip3 install --upgrade yt-dlp
```

### 403 / "Video unavailable"
The video may be age-restricted, region-blocked, or private. Try adding cookies:
```bash
yt-dlp --cookies-from-browser firefox -f "bestvideo+bestaudio/best" \
  --merge-output-format mp4 -o "~/Videos/%(title)s.%(ext)s" "<url>"
```

### Rate limiting / throttling
yt-dlp automatically handles YouTube's throttling. If downloads are slow, add:
```bash
yt-dlp --throttled-rate 100K ...
```

## Requirements

- **yt-dlp**: Already installed at `~/.local/bin/yt-dlp`. Keep updated with `yt-dlp -U`.
- **ffmpeg**: Already installed at `/usr/bin/ffmpeg`. Required for merging video+audio streams.
- No API keys, no Google account, no YouTube subscription needed.

## Maintenance

Run periodically (monthly or when downloads fail):
```bash
yt-dlp -U
```
