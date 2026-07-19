# Agent Skills Installation Guide

> For: Pi Agent (or OpenClaw / Hermes)  
> Pre-requisite: Access to our Google Drive (gog CLI + OAuth configured)  
> Date: 2026-07-11

---

## Overview

Two AgentSkills-standard skill packages are ready on Google Drive. Install them in this order:

1. **gog-workspace** — Gmail, Calendar, Drive, Contacts, Sheets, Docs
2. **youtube-transcript-extractor** — YouTube video transcript extraction

---

## Step 1: Download Both Packages from Google Drive

Use `gog drive download` to pull both zip files:

```bash
# Create skills directory (if it doesn't exist)
mkdir -p ~/.openclaw/skills-temp

# Download gog-workspace
gog drive download 1RCD0dHfavlgG99BJKT1fADiK3s5x7_MN --out /tmp/gog-workspace-v1.0.0.zip

# Download youtube-transcript-extractor
gog drive download 1uebYHDsCrhFdVoWvwyuKMxbhhbc_yJ6c --out /tmp/youtube-transcript-extractor-v1.0.0.zip
```

**Drive file IDs:**
| Skill | File ID | Size |
|-------|---------|------|
| gog-workspace | `1RCD0dHfavlgG99BJKT1fADiK3s5x7_MN` | 7.7 KB |
| youtube-transcript-extractor | `1uebYHDsCrhFdVoWvwyuKMxbhhbc_yJ6c` | 17.5 KB |

---

## Step 2: Install gog-workspace (FIRST)

This skill gives your agent Gmail, Calendar, Drive, Contacts, Sheets, and Docs access via the `gog` CLI.

```bash
# Unzip
unzip /tmp/gog-workspace-v1.0.0.zip -d ~/.openclaw/skills/

# Verify it's there
ls ~/.openclaw/skills/gog-workspace/SKILL.md
```

### If gog CLI is not yet installed, run the bootstrap:

```bash
cd ~/.openclaw/skills/gog-workspace
bash scripts/bootstrap.sh
```

The bootstrap script will:
1. Install `gog` CLI via Homebrew (or guide you to download manually)
2. Walk through Google Cloud Console OAuth setup (create credentials → download client_secret.json)
3. Register credentials and add your Google account
4. Set up the file-based keyring for token storage
5. Append `GOG_ACCOUNT` and `GOG_KEYRING_PASSWORD` to your `.env` file

**If gog is already installed and authenticated, skip the bootstrap.** The SKILL.md alone is enough.

### Verify gog-workspace is working:

```bash
gog gmail messages search "in:inbox" --max 1 --json
```

Should return a JSON response with messages (or empty array if inbox is empty).

---

## Step 3: Install youtube-transcript-extractor (SECOND)

This skill extracts YouTube video transcripts with timestamps, supporting both TXT and JSON output. Multi-fallback pipeline handles most videos.

```bash
# Unzip
unzip /tmp/youtube-transcript-extractor-v1.0.0.zip -d ~/.openclaw/skills/

# Verify it's there
ls ~/.openclaw/skills/youtube-transcript-extractor/SKILL.md
```

### Run the bootstrap to install Python dependencies:

```bash
cd ~/.openclaw/skills/youtube-transcript-extractor
python3 scripts/bootstrap_env.py
```

This creates a `.venv/` directory with `playwright`, `yt-dlp`, `youtube-transcript-api`, and installs Chromium for Playwright. Takes 1-2 minutes.

### Verify it works:

```bash
cd ~/.openclaw/skills/youtube-transcript-extractor
.venv/bin/python scripts/run_transcript.py "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --headless --format both
```

Should output:
```
Wrote transcript: ...youtube_transcript.txt
Wrote JSON: ...youtube_transcript.json
```

### Clean up test output:

```bash
rm -f ~/.openclaw/skills/youtube-transcript-extractor/youtube_transcript.*
```

---

## Step 4: Clean Up

```bash
# Remove temp downloads
rm -f /tmp/gog-workspace-v1.0.0.zip /tmp/youtube-transcript-extractor-v1.0.0.zip
```

---

## Step 5: Verify Both Skills Are Detected

Your agent should now be able to see both skills. Methods vary by platform:

**OpenClaw:**
```bash
openclaw skills list --eligible
```

**Pi Agent:**
The agent should pick up `SKILL.md` files automatically from the skills directory on next reload.

---

## Summary

| # | What | Command |
|---|------|---------|
| 1 | Download gog-workspace | `gog drive download 1RCD0dHfavlgG99BJKT1fADiK3s5x7_MN --out /tmp/gog-workspace-v1.0.0.zip` |
| 2 | Download youtube-transcript-extractor | `gog drive download 1uebYHDsCrhFdVoWvwyuKMxbhhbc_yJ6c --out /tmp/youtube-transcript-extractor-v1.0.0.zip` |
| 3 | Install gog-workspace | `unzip /tmp/gog-workspace-v1.0.0.zip -d ~/.openclaw/skills/` |
| 4 | Bootstrap gog (if needed) | `bash ~/.openclaw/skills/gog-workspace/scripts/bootstrap.sh` |
| 5 | Install youtube-transcript-extractor | `unzip /tmp/youtube-transcript-extractor-v1.0.0.zip -d ~/.openclaw/skills/` |
| 6 | Bootstrap youtube deps | `python3 ~/.openclaw/skills/youtube-transcript-extractor/scripts/bootstrap_env.py` |
| 7 | Clean up | `rm /tmp/*-v1.0.0.zip` |

## What You Get

After installation, your agent gains these capabilities:

**gog-workspace:**
- Read, search, send, reply, archive Gmail
- List, create, update, delete Calendar events
- Upload, download, search, move, rename Google Drive files
- Read, write, append, clear Google Sheets
- Export and view Google Docs
- List and search Contacts

**youtube-transcript-extractor:**
- Extract full transcripts from any public YouTube video
- 4-layer fallback pipeline (API → yt-dlp → watch-page → browser)
- Output in TXT (with timestamps) and/or JSON (with metadata)
- Age-restricted video support via Firefox cookies
- 6 automated tests included

---

*Generated by NEO on 2026-07-11. Save this file alongside the zip packages on Google Drive.*
