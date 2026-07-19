---
name: youtube-transcript-extractor
description: Extract full YouTube video transcripts with timestamps, dual output (text + structured JSON), and age-restricted video support via browser cookies. Multi-fallback pipeline: yt-dlp → youtube-transcript-api → watch-page parsing → Playwright browser. Use when given a YouTube URL (youtube.com/watch?v= or youtu.be/) and asked to fetch, extract, download, save, or copy the transcript/captions/subtitles. Supports age-restricted videos via YOUTUBE_COOKIES_FILE. Outputs both raw TXT and structured JSON.
version: 1.0.0
license: MIT
compatibility: "Requires Python 3.10+, Linux/macOS. Optional: Firefox for cookie-based auth on age-restricted videos."
metadata:
  openclaw:
    requires:
      bins:
        - python3
      env:
        - YOUTUBE_COOKIES_FILE
    envVars:
      - name: YOUTUBE_COOKIES_FILE
        required: false
        description: "Path to Netscape-format cookies.txt exported from Firefox (signed into YouTube). Required only for age-restricted videos. Run scripts/export_cookies.sh to generate."
      - name: YOUTUBE_TRANSCRIPT_HEADLESS
        required: false
        description: "Set to 1 to run Playwright browser in headless mode (no display). Default: show browser."
    install:
      - kind: node
        package: playwright
        bins: [playwright]
    emoji: "📝"
    homepage: "https://github.com/pmpmtj/youtube-transcript-extractor"
---

# YouTube Transcript Extractor

Extract complete YouTube video transcripts with timestamps. Multi-fallback pipeline with support for age-restricted videos via Google account cookies.

Works with **OpenClaw**, **Pi**, **Hermes**, and any agent supporting the AgentSkills standard.

## Features

- **4-layer fallback**: yt-dlp → youtube-transcript-api → watch-page captions → Playwright browser UI
- **Age-restricted support**: Authenticated via browser cookies (Firefox + `neopmpmtj@gmail.com`)
- **Dual output**: Raw TXT + structured JSON (title, channel, duration, chapters, segments)
- **Self-bootstrapping**: `bootstrap_env.py` creates venv and installs all dependencies
- **No API keys required**: Uses YouTube's public endpoints + browser auth

## First-Time Setup

```bash
cd youtube-transcript-extractor
python3 scripts/bootstrap_env.py
```

This creates `.venv/`, installs `playwright`, `yt-dlp`, `youtube-transcript-api`, and downloads Chromium.

### Cookie Auth (for age-restricted videos)

To access age-restricted videos, export cookies from Firefox signed into `neopmpmtj@gmail.com`:

```bash
bash scripts/export_cookies.sh
```

Or manually:

```bash
# Install the cookies.txt extension in Firefox
# Visit youtube.com, sign in as neopmpmtj@gmail.com
# Export cookies → save as cookies.txt in this skill root
```

Then set the env var or use the `--cookies` flag:

```bash
export YOUTUBE_COOKIES_FILE=./cookies.txt
```

## Usage

### From an AI agent (OpenClaw / Pi / Hermes)

The agent automatically picks up this skill. Just ask:

> "Get the transcript of https://www.youtube.com/watch?v=VIDEO_ID"

The skill's `description` triggers on any transcript/captions/subtitle request.

### From the command line

```bash
# Basic — text output (default)
.venv/bin/python scripts/run_transcript.py "https://www.youtube.com/watch?v=VIDEO_ID"

# JSON output
.venv/bin/python scripts/run_transcript.py "https://www.youtube.com/watch?v=VIDEO_ID" --format json

# Both TXT + JSON
.venv/bin/python scripts/run_transcript.py "https://www.youtube.com/watch?v=VIDEO_ID" --format both

# Headless mode (no browser window)
.venv/bin/python scripts/run_transcript.py "https://www.youtube.com/watch?v=VIDEO_ID" --headless
```

### Output Files

| Flag | Output | Location |
|------|--------|----------|
| `text` (default) | `youtube_transcript.txt` | Skill root |
| `json` | `youtube_transcript.json` | Skill root |
| `both` | Both files | Skill root |

### JSON Output Structure

```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "title": "Video Title",
  "channel": "Channel Name",
  "duration_seconds": 1234,
  "segment_count": 150,
  "extraction_method": "yt-dlp",
  "has_cookies": false,
  "segments": [
    {"timestamp": "0:00", "text": "First line of transcript..."},
    {"timestamp": "0:05", "text": "Second line..."}
  ]
}
```

## Pipeline (Extraction Order)

1. **youtube-transcript-api** — Fastest, no browser. Fails if YouTube blocks the IP.
2. **yt-dlp** — Resolves current caption URLs via YouTube's extractor. Supports `YOUTUBE_COOKIES_FILE` for auth.
3. **Watch-page captions** — Parses `ytInitialPlayerResponse` from the HTML. No external deps.
4. **Playwright browser** — Opens YouTube, expands description, clicks "Show transcript", scrolls all segments. Last resort. Uses `YOUTUBE_TRANSCRIPT_HEADLESS` env var.

## Configuration

| Env Var | Required | Default | Purpose |
|---------|----------|---------|---------|
| `YOUTUBE_COOKIES_FILE` | No | — | Path to Netscape cookies.txt for age-restricted videos |
| `YOUTUBE_TRANSCRIPT_HEADLESS` | No | `0` (show browser) | Set to `1` for headless Playwright |

## Package Structure

```
youtube-transcript-extractor/
├── SKILL.md                # This file — skill definition
├── requirements.txt         # Python deps (playwright, yt-dlp, youtube-transcript-api)
├── requirements-test.txt    # Test deps (pytest)
├── .gitignore               # Excludes .venv/, cookies.txt, output files
├── .clawhubignore           # Excludes same for ClawHub publishing
├── scripts/
│   ├── bootstrap_env.py     # Creates .venv and installs deps
│   ├── run_transcript.py    # CLI entry point with --format flag
│   ├── save_youtube_transcript.py  # Public entry point (imports implementation)
│   ├── youtube_transcript_browser.py  # Core implementation
│   ├── export_cookies.sh    # Helper to export Firefox cookies
│   └── verify_contract.py   # Contract checks and unit tests
├── tests/
│   └── conftest.py          # Test configuration
└── cookies.txt              # (gitignored) — your exported YouTube cookies
```

## Notes

- **Cookies expire** — re-export from Firefox every few weeks if using age-restricted access
- **Transcript quality** varies — auto-generated captions may have errors
- **Large videos** (>3 hours) may need longer timeouts; edit `MAX_TRANSCRIPT_SCROLL_ROUNDS` in `youtube_transcript_browser.py`
- **Works with** both `youtube.com/watch?v=` and `youtu.be/` URLs
