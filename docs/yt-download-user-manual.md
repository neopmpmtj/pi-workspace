# YouTube Video Downloader

Download any YouTube video for offline viewing. No logins, no subscriptions, no API keys.

**Requires**: `yt-dlp` + `ffmpeg` (both already installed). Run `yt-dlp -U` monthly to keep it updated — YouTube breaks old versions.

## Quick start

```bash
yt-download "<youtube_url>"
```

Video lands in `~/Videos/` at the best available quality, merged to MP4.

## Quality options

```bash
yt-download "<url>"          # best video + best audio (default)
yt-download "<url>" 1080     # cap at 1080p
yt-download "<url>" 720      # cap at 720p
yt-download "<url>" 480      # cap at 480p
yt-download "<url>" 360      # cap at 360p
yt-download "<url>" audio    # audio only → MP3
```

## Examples

```bash
yt-download "https://www.youtube.com/watch?v=u5h2OCcKYkc"
yt-download "https://www.youtube.com/watch?v=u5h2OCcKYkc" 720
yt-download "https://youtu.be/dQw4w9WgXcQ" audio
```

## Via the AI agent

Just paste the URL and say "download this video." The agent loads the yt-download skill automatically.

## If something breaks

1. **Update yt-dlp**: `yt-dlp -U` (fixes 90% of failures)
2. **Age-restricted / login video**: `yt-dlp --cookies-from-browser firefox -f "bestvideo+bestaudio/best" --merge-output-format mp4 -o "~/Videos/%(title)s.%(ext)s" "<url>"`
3. **Full docs**: `~/.pi/agent/skills/yt-download/SKILL.md`
