---
name: gog-workspace
description: Google Workspace CLI for Gmail, Calendar, Drive, Contacts, Sheets, and Docs. Full Google productivity suite from any AI agent. Use when asked to check/send/read email, manage calendar events, search/upload to Google Drive, access contacts, or work with Google Sheets/Docs. Supports OAuth authentication with your own Google account.
version: 1.0.0
license: MIT
compatibility: "Requires gog CLI (install via bootstrap.sh). macOS/Linux. Google Cloud Console project for OAuth."
metadata:
  openclaw:
    requires:
      bins:
        - gog
      env:
        - GOG_ACCOUNT
        - GOG_KEYRING_PASSWORD
    primaryEnv: GOG_ACCOUNT
    envVars:
      - name: GOG_ACCOUNT
        required: false
        description: "Your Google account email (e.g. neopmpmtj@gmail.com). Set to avoid repeating --account."
      - name: GOG_KEYRING_PASSWORD
        required: true
        description: "Password for the file-based keyring that stores OAuth tokens. Set this in your .env file."
    install:
      - kind: brew
        formula: steipete/tap/gogcli
        bins: [gog]
        label: "Install gog CLI"
    emoji: "📧"
    homepage: "https://gogcli.sh"
---

# GOG Workspace — Google Suite for AI Agents

Full Google Workspace access from any AI agent: Gmail, Calendar, Drive, Contacts, Sheets, and Docs. Uses the `gog` CLI with OAuth authentication.

Works with **OpenClaw**, **Pi**, **Hermes**, and any agent supporting the AgentSkills standard.

## First-Time Setup

```bash
cd gog-workspace
bash scripts/bootstrap.sh
```

This script will:
1. Install the `gog` CLI (Homebrew on macOS/Linux, or manual download)
2. Walk you through Google Cloud Console OAuth setup
3. Configure `gog auth` with your credentials
4. Set up the file-based keyring for token storage

### Manual Setup (if bootstrap fails)

**Step 1: Install gog**

```bash
# macOS / Linux with Homebrew
brew install steipete/tap/gogcli

# Or download from GitHub releases
# https://github.com/steipete/gogcli/releases
```

**Step 2: Create Google Cloud Console project**

1. Go to https://console.cloud.google.com/apis/credentials
2. Create a project → Create OAuth 2.0 Client ID → Desktop application
3. Download the JSON file as `client_secret.json`

**Step 3: Configure gog**

```bash
gog auth credentials ~/Downloads/client_secret.json
gog auth add you@gmail.com --services gmail,calendar,drive,contacts,docs,sheets
```

**Step 4: Set up keyring**

```bash
# File-based keyring (recommended for agents)
gog auth keyring file
# You'll be prompted for a password — save this in your .env:
# GOG_KEYRING_PASSWORD=your-password-here
```

**Step 5: Set env vars**

Add to your `.env` file:
```bash
GOG_ACCOUNT=you@gmail.com
GOG_KEYRING_PASSWORD=your-password-here
```

## Authentication

GOG uses OAuth 2.0 with Google. Tokens are stored in a file-based keyring at `~/.config/gogcli/`. The keyring password is set via `GOG_KEYRING_PASSWORD` env var.

- **Account:** Set via `GOG_ACCOUNT` env var (avoids repeating `--account` on every command)
- **Token refresh:** Automatic — no manual re-auth needed once set up
- **Multiple accounts:** `gog auth list` to see configured accounts

## Gmail

### Search & Read

```bash
# Search inbox (thread-based)
gog gmail search "is:unread newer_than:7d" --max 10

# Search messages (per-email, ignores threading)
gog gmail messages search "in:inbox newer_than:24h" --max 50 --json

# Get specific message
gog gmail get <messageId> --format full --json

# Download attachment
gog gmail attachment <messageId> <attachmentId> --out ./file.pdf
```

### Send & Reply

```bash
# Plain text send
gog gmail send --to recipient@example.com --subject "Subject" --body "Message"

# Multi-line via file
gog gmail send --to recipient@example.com --subject "Subject" --body-file ./message.txt

# HTML send
gog gmail send --to recipient@example.com --subject "Subject" --body-html "<p>Hello</p>"

# Reply to a message
gog gmail send --to recipient@example.com --subject "Re: Original" --body "Reply" --reply-to-message-id <msgId>

# Create draft
gog gmail drafts create --to recipient@example.com --subject "Draft" --body-file ./message.txt

# Send draft
gog gmail drafts send <draftId>
```

### Labels & Organization

```bash
# Modify labels (add/remove)
gog gmail messages modify <msgId> --add "LabelName"
gog gmail messages modify <msgId> --remove INBOX

# Archive (remove INBOX label)
gog gmail messages modify <msgId> --remove INBOX
```

## Calendar

```bash
# List events
gog calendar events primary --from 2026-07-11T00:00:00 --to 2026-07-12T23:59:59

# Create event
gog calendar create primary \
  --summary "Team Meeting" \
  --from 2026-07-11T14:00:00 \
  --to 2026-07-11T15:00:00 \
  --event-color 7

# Update event
gog calendar update primary <eventId> --summary "Updated Title" --event-color 4

# Delete event
gog calendar delete primary <eventId>

# Show available colors
gog calendar colors
```

### Event Colors

| ID | Color | Hex |
|----|-------|-----|
| 1 | Lavender | #a4bdfc |
| 2 | Sage | #7ae7bf |
| 3 | Grape | #dbadff |
| 4 | Flamingo | #ff887c |
| 5 | Banana | #fbd75b |
| 6 | Tangerine | #ffb878 |
| 7 | Peacock | #46d6db |
| 8 | Graphite | #e1e1e1 |
| 9 | Blueberry | #5484ed |
| 10 | Basil | #51b749 |
| 11 | Tomato | #dc2127 |

## Google Drive

```bash
# Search files
gog drive search "type:document" --max 10

# List files in folder
gog drive files list --parent <folderId> --max 50 --json

# Upload file
gog drive upload ./document.pdf --json

# Upload and convert to Google format
gog drive upload ./spreadsheet.xlsx --convert --json

# Download file
gog drive download <fileId> --out ./downloaded.pdf

# Move file to folder
gog drive move <fileId> --parent <folderId>

# Rename file
gog drive rename <fileId> "New Name"

# Delete file
gog drive delete <fileId>
```

## Google Sheets

```bash
# Read cell range
gog sheets get <sheetId> "Sheet1!A1:D10" --json

# Update cells
gog sheets update <sheetId> "Sheet1!A1:B2" \
  --values-json '[["Header1","Header2"],["val1","val2"]]' \
  --input USER_ENTERED

# Append rows (INSERT_ROWS preserves existing data below)
gog sheets append <sheetId> "Sheet1!A:C" \
  --values-json '[["x","y","z"]]' \
  --insert INSERT_ROWS

# Clear range
gog sheets clear <sheetId> "Sheet1!A2:Z"

# Get sheet metadata (tabs, ranges)
gog sheets metadata <sheetId> --json
```

## Google Docs

```bash
# Export to text
gog docs export <docId> --format txt --out /tmp/doc.txt

# View document content
gog docs cat <docId>

# Copy document
gog docs copy <docId> --name "Copy of Document"
```

## Google Contacts

```bash
# List contacts
gog contacts list --max 20 --json

# Search contacts
gog contacts search "John" --json
```

## Scripting Tips

- **`--json`**: Structured output for parsing by agents
- **`--no-input`**: Prevent interactive prompts in automated workflows
- **`GOG_ACCOUNT`**: Set once to avoid `--account` on every command
- **`GOG_KEYRING_PASSWORD`**: Required for non-interactive token access
- **`--body-file -`**: Read email body from stdin (great for templates)

## Common Patterns

### Check Inbox (Agent Workflow)

```bash
gog gmail messages search "in:inbox newer_than:24h" --max 50 --json
```

### Send Attachment via Gmail

```bash
gog gmail send \
  --to recipient@example.com \
  --subject "Here is the file" \
  --body "Please find the attachment." \
  --attach ./document.pdf
```

### Export Sheet to XLSX

```bash
gog sheets export <sheetId> --out ./exported.xlsx --format xlsx
```

### Bulk Archive Old Emails

```bash
# Find old emails
gog gmail messages search "older_than:30d in:inbox" --max 100 --json | \
  python3 -c "import sys,json; [print(m['id']) for m in json.load(sys.stdin)['messages']]" | \
  while read id; do gog gmail messages modify "$id" --remove INBOX; done
```

## Notes

- **Gmail search** (`gog gmail search`) returns threads. Use `gog gmail messages search` for individual emails.
- **Sheets `--insert INSERT_ROWS`** is important for appending — it shifts existing rows down instead of overwriting.
- **Drive upload `--convert`** converts Office files to native Google format.
- **Calendar event IDs** are stable; save them for updates/deletes.
- **Confirm before sending** emails in automated workflows.
- **Rate limits**: Google has usage quotas. Leave pauses between bulk operations.
- **Keyring**: The file-based keyring stores OAuth tokens encrypted with your password at `~/.config/gogcli/`.
