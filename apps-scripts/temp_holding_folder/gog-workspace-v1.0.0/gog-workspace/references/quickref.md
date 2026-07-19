# GOG Workspace — Quick Reference

## Architecture

```
gog-workspace/
├── SKILL.md              # Agent-readable skill definition
├── scripts/
│   └── bootstrap.sh      # One-time setup (install + OAuth)
└── references/
    └── quickref.md       # This file
```

## How It Works

1. **gog CLI** — The binary that talks to Google APIs via OAuth
2. **Keyring** — File-based encrypted storage for OAuth tokens at `~/.config/gogcli/`
3. **SKILL.md** — The agent reads this for commands and patterns
4. **bootstrap.sh** — Sets up gog + OAuth + keyring on a new machine

## Keyring Details

- **Type:** File-based (stored at `~/.config/gogcli/credentials.json`)
- **Encryption:** AES-encrypted with the password set during `gog auth keyring file`
- **Env var:** `GOG_KEYRING_PASSWORD` must be set in `.env` for non-interactive use
- **Token refresh:** Automatic — OAuth refresh tokens are stored and rotated

## Supported Google Services

| Service | gog subcommand | Key Operations |
|---------|---------------|----------------|
| Gmail | `gog gmail` | Search, read, send, reply, draft, archive, label |
| Calendar | `gog calendar` | List, create, update, delete events |
| Drive | `gog drive` | Search, upload, download, move, rename, delete |
| Contacts | `gog contacts` | List, search |
| Sheets | `gog sheets` | Read, update, append, clear, export |
| Docs | `gog docs` | Export, view, copy |

## Troubleshooting

### "gog: command not found"
- Run `bash scripts/bootstrap.sh` to install gog
- Or: `brew install steipete/tap/gogcli`

### "authentication required" / "token expired"
- `gog auth list` — check if account is configured
- `gog auth add you@gmail.com --services gmail,calendar,drive,contacts,docs,sheets`
- Re-auth: `gog auth login you@gmail.com`

### "keyring password" prompts
- Set `GOG_KEYRING_PASSWORD` in your `.env` file
- If you forgot the password: delete `~/.config/gogcli/credentials.json` and re-run bootstrap.sh

### Rate limiting
- Google APIs have quotas. Typical limits: 10,000 requests/day for Gmail, 20,000 for Drive
- If hitting limits: add delays between bulk operations

## Security Notes

- **client_secret.json**: Keep this file private — it's your OAuth application credential
- **Keyring password**: Don't share. Store only in `.env` (which is gitignored)
- **OAuth tokens**: Stored encrypted at `~/.config/gogcli/`. Delete this file to revoke all access.
- **Scopes**: The bootstrap sets up full access. To reduce scopes: `gog auth add <email> --services gmail,drive` (only what you need)
