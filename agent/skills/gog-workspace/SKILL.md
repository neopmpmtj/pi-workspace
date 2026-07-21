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

## 🚨 CRITICAL: Command Discovery Protocol

**The `gog` CLI evolves independently of this document. Never trust hardcoded command examples — always verify against the live CLI.**

Before running ANY gog command:
1. **Discover subcommands:** `gog <service> --help`
2. **Discover flags:** `gog <service> <subcommand> --help`
3. **Then execute** with verified syntax

A cached reference is auto-generated at `references/quickref.md` (run `scripts/generate-ref.sh` to regenerate). Use it as a starting point, but `--help` is the source of truth.

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

## Capabilities by Service

> Use `gog <service> --help` for exact command names and flags. The subcommand list below shows what's possible.

### Gmail (`gog gmail`)

**Capabilities:** Search threads and messages, read individual emails (full/metadata/raw), send plain-text/HTML/multi-part emails, reply to messages, create and send drafts, manage labels (add/remove/archive), download attachments, bulk operations via message IDs.

**Key patterns:**
- `gog gmail search` returns **threads** (groups messages by subject). Use `gog gmail messages search` for individual emails.
- Send safety: review before sending in automated workflows.
- Labels: add/remove labels via message IDs for inbox management.

### Calendar (`gog calendar`)

**Capabilities:** List calendars, list/create/update/delete events, query by time range, set event colors (see table below), manage recurring events.

**Event Colors:**

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

### Google Drive (`gog drive`)

**Capabilities:** List files in folders, full-text search, print folder trees, get file metadata, download/upload files (with optional conversion to Google formats), create folders, move/rename/delete files, share/unshare, manage permissions and labels, list shared drives, track revisions and changes.

**Key patterns:**
- `--convert` converts Office files to native Google format on upload.
- File IDs are stable; save them for scripting.

### Google Contacts (`gog contacts`)

**Capabilities:** List all contacts, search by name/email/phone, get individual contacts, export as vCard.

### Google Sheets (`gog sheets`)

**Capabilities:** Read cell ranges, update cells, append rows, clear ranges, get sheet metadata (tabs, ranges), export to various formats.

**Key patterns:**
- `--insert INSERT_ROWS` is critical for appending — it shifts existing rows down instead of overwriting.
- Use `--values-json` with properly escaped JSON arrays for writes.
- `--input USER_ENTERED` treats values as if typed by a user (preserves formatting).

### Google Docs (`gog docs`)

**Capabilities:** Export to multiple formats (pdf, docx, txt, md, html), read document content as text, get metadata, create new docs, copy existing docs.

## Scripting Tips

- **`--json`**: Structured output for parsing by agents
- **`--no-input`**: Prevent interactive prompts in automated workflows
- **`GOG_ACCOUNT`**: Set once to avoid `--account` on every command
- **`GOG_KEYRING_PASSWORD`**: Required for non-interactive token access
- **`--body-file -`**: Read email body from stdin (great for templates)

## Common Patterns

### Check Inbox
Use `gog gmail messages` (not `gog gmail`) to search individual emails. Add `--max` to limit results and `--json` for parsing.

### Send Attachment via Gmail
Use `gog gmail send` with `--attach` pointing to a local file.

### Export Sheet to XLSX
Use `gog sheets` export commands with `--format xlsx` and `--out`.

### Bulk Archive Old Emails
Search messages → extract IDs (e.g., with `python3` or `jq`) → pipe to `gog gmail messages modify --remove INBOX`.

## Notes

- **Calendar event IDs** are stable; save them for updates/deletes.
- **Confirm before sending** emails in automated workflows.
- **Rate limits**: Google has usage quotas. Leave pauses between bulk operations.
- **Keyring**: File-based encrypted token storage at `~/.config/gogcli/`.
