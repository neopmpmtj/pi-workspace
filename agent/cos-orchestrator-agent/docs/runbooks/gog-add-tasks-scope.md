# Add the Google Tasks scope to the gog refresh token

Why: `tasks-agent` (and the reminder node with `writer: tasks`) reach Google Tasks with
`gog tasks`. Before 2026-11-07 the stored token only carried
`calendar, drive, gmail, sheets`, so every `gog tasks` call failed. The scope set is per
refresh token, so adding Tasks means re-consenting once for the same account.

Key facts:

- Account: `neopmpmtj@gmail.com`, client `default`, refresh token in gog's keyring.
- The keyring password that actually unlocks the token is in **`~/.pi/agent/.env`**
  (`GOG_KEYRING_PASSWORD`). The copy in `~/.pi/agent-tasks-agent/.env` does not match — it
  gives `aes.KeyUnwrap(): integrity check failed`. Any gog command that must read or write the
  token has to be run with the legacy file sourced.
- Re-authorising **replaces** the token's service set. If you ask only for `tasks`, calendar,
  drive, gmail and sheets stop working. Always pass the full union.
- Google only allows loopback redirects for this client, so the redirect URI is
  `http://127.0.0.1:<random port>/oauth2/callback`. The browser will show a connection error
  on the phone/laptop — that is expected. What matters is the full URL in the address bar.
- Step 1 writes `~/.config/gogcli/oauth-manual-state-<state>.json` (holds the PKCE verifier).
  Step 2 must reuse the identical redirect URI and services, and finish inside the default
  5-minute window, or start over at step 1.

## Delivering the URL to a phone

The consent URL is ~870 characters. Pasted into a chat it gets truncated, and Google then
answers `invalid_request: Required parameter is missing: response_type` (the tell is a
`client_id` cut off as `...43.a`). Do not send it as chat text.

Serve it instead from the site this host already runs — `/static/` on `uttdty.com` is an
nginx alias to `/home/pmpmt/app/uttdty_dashboard/staticfiles/`, writable as `pmpmt`:

```bash
url=$(cat /tmp/gog-auth-url.txt)   # from step 1
# write a tiny <meta http-equiv="refresh" content="0;url=..."> page to
#   /home/pmpmt/app/uttdty_dashboard/staticfiles/gog-tasks-<slug>.html
# and send the short link: https://uttdty.com/static/gog-tasks-<slug>.html
```

Verify with `curl -o /dev/null -w '%{http_code}'` before sending, and delete the page once the
token is exchanged. Raise `--timeout 30m` on step 1, or the pending state expires before a
phone user gets to it; a *stale* state file is silently reused (`state_reused true`) — delete
`~/.config/gogcli/oauth-manual-state-*.json` first if in doubt.

## Step 1 — print the consent URL

```bash
cd ~ && set -a && . ~/.pi/agent/.env && set +a
gog auth add neopmpmtj@gmail.com \
  --services calendar,drive,gmail,sheets,tasks \
  --gmail-scope full --drive-scope full \
  --remote --step 1 --force-consent
```

Prints `auth_url  https://accounts.google.com/...` plus `state_reused  false`, and the exact
step-2 invocation. Sign in as `neopmpmtj@gmail.com` and approve the Tasks scope.

## Step 2 — exchange the redirect URL

```bash
cd ~ && set -a && . ~/.pi/agent/.env && set +a
gog auth add neopmpmtj@gmail.com \
  --services calendar,drive,gmail,sheets,tasks \
  --gmail-scope full --drive-scope full \
  --remote --step 2 --force-consent \
  --redirect-uri http://127.0.0.1:<port-from-step-1>/oauth2/callback \
  --auth-url '<full URL from the browser address bar>'
```

The pasted URL may be `http://127.0.0.1:.../oauth2/callback?state=...&code=...&scope=...`.

## Done on 2026-11-07

- Token: `calendar,drive,gmail,sheets,tasks`, account `neopmpmtj@gmail.com`, client `default`.
- `Reminders` task list created (`bVZhcmpkbWR4bUs4WldLNg`); only `My Tasks` existed before.
- `~/.pi/agent-tasks-agent/.env` fixed: `GOG_ACCOUNT` was **empty** (`missing --account`) and
  `GOG_KEYRING_PASSWORD` was a different string (`aes.KeyUnwrap(): integrity check failed`).
  Both now copied from `~/.pi/agent/.env`.
- The reminder and calendar nodes do not use that file; they read
  `GOG_ENV = ~/.pi/agent-gog-workspace-agents/sm-google-workspace/.env`, which already had the
  matching keyring password — `gog tasks add ... --dry-run` under that env exits 0.
- Proof: `pi-tasks-agent -p "list my task lists"` returns both lists; `gog calendar events
  --today` still returns the reminder events, so the re-consent did not drop a service.

## Verify

```bash
cd ~ && set -a && . ~/.pi/agent/.env && set +a
gog auth list --json            # services must now include "tasks"
gog tasks lists --plain         # should print My Tasks and Reminders
```

Then check the sibling can see it:

```bash
cd ~/.pi/agent-tasks-agent/tasks-agent && pi-tasks-agent -p "list my task lists"
```

If `tasks-agent` fails with `missing --account`, its `GOG_ACCOUNT` is empty; if it fails with the
keyring error, its `GOG_KEYRING_PASSWORD` differs from `~/.pi/agent/.env`. Both are independent
of the scope.

## Rollback

Nothing to roll back but the token: re-run step 1/2 without `tasks`, or re-run the original
`--services calendar,drive,gmail,sheets`.
