# Swap gog to a new Google OAuth client

Use when the current client is unusable (project locked, client deleted, wrong project) and a
fresh OAuth client has to be created. This does **not** by itself fix the 7-day token death —
that is the consent screen's publishing status, which is per project. A new client in a
Testing-mode project still dies after 7 days.

## What the console must produce

In the target project (note the **project number**, e.g. `257469568858`):

1. **APIs & Services → Library** — enable `calendar-json.googleapis.com`,
   `tasks.googleapis.com`, `drive.googleapis.com`, `gmail.googleapis.com`,
   `sheets.googleapis.com`.
2. **OAuth consent screen → Branding** — App name `Pi Agent`, user support email, app home page
   `https://uttdty.com/static/pi-agent.html`, privacy policy
   `https://uttdty.com/static/pi-agent-privacy.html`, authorised domain `uttdty.com`,
   developer contact email. (See `gog-oauth-consent-screen.md` for the traps.)
3. **OAuth consent screen → Publish app** — `In production`, not `Testing`. Unverified is
   acceptable; verification only removes the warning screen.
4. **Credentials → Create credentials → OAuth client ID → application type `Desktop app`**.
   - `Desktop app` is required: gog's flow redirects to `http://127.0.0.1:<random port>/oauth2/callback`.
   - A `Web application` client cannot use random loopback ports and will fail with
     `redirect_uri_mismatch`.
   - Download the JSON (`client_secret_*.apps.googleusercontent.com.json`).

## Server-side swap

The secret never lives in a plain file: gog keeps the client secret encrypted in its keyring
and leaves only `client_id` in `~/.local/share/gogcli/credentials.json`. Let gog do the move.

```bash
cd ~ && set -a && . ~/.pi/agent/.env && set +a      # GOG_KEYRING_PASSWORD lives here

# 0. keep the old client, so a rollback is one file copy
cp -p ~/.local/share/gogcli/credentials.json ~/.local/share/gogcli/credentials.json.bak-$(date +%Y%m%d)

# 1. install the new client (writes client_id + puts the secret in the keyring)
gog auth credentials set /path/to/client_secret_XXXX.json
gog auth credentials list          # CLIENT default · SECRET_KEYRING should now be true
```

Then consent again — the new client has no token:

```bash
gog auth add neopmpmtj@gmail.com \
  --services calendar,drive,gmail,sheets,tasks \
  --gmail-scope full --drive-scope full \
  --remote --step 1 --force-consent --timeout 30m
# open the printed auth_url (serve it from uttdty static if it is long), approve,
# then step 2 with the redirect URL from the address bar
```

Step 2 requirements are the traps in `gog-add-tasks-scope.md`: identical `redirect_uri`, the
services list, and completion inside the timeout window.

## Verify

```bash
cd ~ && set -a && . ~/.pi/agent/.env && set +a
gog auth list --json | head -20        # five services, auth: oauth, new created_at
gog calendar events --today --plain
gog tasks lists --plain                # My Tasks + Reminders
gog drive ls --max 1 --plain
```

The old token entry is dead weight; `gog auth credentials remove` with no argument removes the
default client's stored token, so only run it if the swap is confirmed good.

```bash
~/.pi/agent/cos-orchestrator-agent/scripts/gog-token-keepalive.sh; echo "exit=$?"
```

## Rollback

```bash
cp -p ~/.local/share/gogcli/credentials.json.bak-<date> ~/.local/share/gogcli/credentials.json
```

The old refresh token is still in the keyring as long as its client secret was not removed, so
the old client starts working again immediately.

## Then watch day 8

The proof is time, not a successful call: `~/.pi/agent/logs/gog-token-keepalive.log` must keep
printing `OK` past the 7-day mark, and `gog auth list --json` `created_at` must stay put.
