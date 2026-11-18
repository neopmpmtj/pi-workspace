# gog OAuth consent screen — stop the token dying every week

The symptom: `gog` starts failing everywhere with

```
oauth2: "invalid_grant" "Token has been expired or revoked"
```

from Calendar, Tasks, Drive and Gmail at once, days after a successful re-consent.

**The tell:** the token works for about a week and then dies. That is the fingerprint of an
OAuth consent screen left in **Testing** publishing status — Google issues 7-day refresh tokens
to apps in Testing. A real revocation looks the same, but it does not repeat on a 7-day beat.

Observed on this host: re-consented 2026-11-07, healthy through 2026-11-14 08:00, dead from
2026-11-15 08:00 (keepalive probe, streak 4), re-consented 2026-11-18.

## Which project to open — read this first

Only one client is live. The other two numbers on this box are decoys:

| Path | Client / project | Status |
|---|---|---|
| `~/.local/share/gogcli/credentials.json` | `257469568858-…` | **live** — this is the one the consent URL uses with `--client default` |
| `~/.pi/agent/.env` → `GOOGLE_CLIENT_ID` | `811473298315-…` | not what gog uses; do not edit that project |

A third client, `844606295733-…` in `~/.config/gogcli/credentials.json`, was removed on
2026-11-18 together with its keyring backups (`~/.config/gogcli` now holds only `config.json`
and the two download folders). Pre-deletion snapshot:
`~/backup-gogcli-config-20261118.tar.gz` (mode 600, contains encrypted tokens — delete once the
production switch is proven).

Trust the number in the consent URL:

```bash
cd ~ && set -a && . ~/.pi/agent/.env && set +a
gog auth add neopmpmtj@gmail.com --services calendar --remote --step 1 --force-consent 2>/dev/null \
  | awk -F'\t' '/^auth_url/{print $2}' | grep -o 'client_id=[0-9]*'
```

The digits before the first `-` are the **project number** to open in the console.

## The fix — publish the app

1. Open <https://console.cloud.google.com/apis/credentials/consent?project=257469568858>
   (replace the project number if the check above printed a different one; the project picker at
   the top of <https://console.cloud.google.com> also works — pick by project **number**).
2. Sign in as `neopmpmtj@gmail.com`, the same account that owns the client.
3. On **OAuth consent screen**, read **Publishing status**:
   - `Testing` → this is the cause. Press **Publish app** → **Confirm**.
   - `In production` → the 7-day theory is wrong; look for an actual consent revocation under
     <https://myaccount.google.com/permissions> (the token shows as "gogcli" or the app name).
4. While there, check the scopes the app requests:
   `calendar`, `drive`, `gmail.modify`, `gmail.settings.basic`, `gmail.settings.sharing`,
   `spreadsheets`, `tasks`, `openid`, `email`, `userinfo.email`.
   Adding a scope later means another consent round — set the full union now.
5. Check the APIs are enabled for the same project, under **APIs & Services → Enabled APIs**:
   `calendar-json.googleapis.com`, `tasks.googleapis.com`, `drive.googleapis.com`,
   `gmail.googleapis.com`, `sheets.googleapis.com`.

### Branding prerequisites (blocks "Publish app" when missing)

A greyed-out **Publish app** button with "Valid app name, support email, homepage url, and
privacy policy url are required" means the **Branding** page is incomplete. Values used on
2026-11-18, served from the static alias this host already has:

| Field | Value |
|---|---|
| App name | `Pi Agent` |
| User support email | `neopmpmtj@gmail.com` |
| App home page | `https://uttdty.com/static/pi-agent.html` |
| Privacy policy | `https://uttdty.com/static/pi-agent-privacy.html` |
| Authorised domain | `uttdty.com` |
| Developer contact | `neopmpmtj@gmail.com` |

Do **not** use `https://uttdty.com/` as the home page: it 301s to an `/accounts/login/` page and
Google rejects a login-walled home page. The two pages above are files under
`/home/pmpmt/app/uttdty_dashboard/staticfiles/` and return 200 without a session. Keep them in
place — Google re-reads them during review.

## What "available to any user with a Google Account" actually means

The dialog warns about *eligibility*, not about data. Publishing removes the Test-users list
requirement: any Google account that has your `client_id` could open the consent screen and be
asked to approve. Nothing is shared with them, and no directory listing or app-store entry is
created — the client is discoverable only if you hand out its id.

What changes, concretely:

| | Testing | In production (unverified) |
|---|---|---|
| Refresh token lifetime | 7 days | until revoked |
| Who may authorise | accounts on the test-user list | any Google account |
| Consent screen | no warning | "Google hasn't verified this app" → Advanced → Go to (unsafe) |
| User cap | 100 test users | 100 users until verified |
| Verification | not required | required for sensitive/restricted scopes to drop the warning |

Your data is not exposed by publishing: access still needs a human to sign in and approve, and
only `neopmpmtj@gmail.com` ever will. The assets to protect stay the same as before — the
refresh token in the keyring and the client secret. Treat a Desktop client secret as
semi-public anyway (Google ships them inside installed apps); the token is what matters.

Residual risks that are real but small here:

- **Quota theft** — anyone with the client id could consume the project's API quota. Bounded by
  the 100-user cap and by the fact that the id is not published.
- **Verification request** — Google may email the developer contact asking to verify the
  restricted Gmail scopes. Ignoring it leaves the app working with the warning; it is not a
  silent failure mode.
- **Brand** — the app name `Pi Agent` appears on the consent screen; keep it free of Google
  marks.

Kill switch, unchanged: <https://myaccount.google.com/permissions>.

## The exact hop chain the user sees

```
1. https://uttdty.com/static/gog-reauth-<slug>.html      our page, one <meta refresh>, no script
        ↓ 302
2. https://accounts.google.com/o/oauth2/auth?client_id=…&redirect_uri=http%3A%2F%2F127.0.0.1%3A<port>%2Foauth2%2Fcallback
        ↓ user signs in, approves scopes          (Google's origin — no credential ever touches our host)
3. http://127.0.0.1:<port>/oauth2/callback?code=…&state=…
        ↓ browser shows "can't connect" — expected
4. the operator copies that address-bar URL back into the chat; gog exchanges code+PKCE verifier
```

Step 1 exists only because the consent URL is ~870 characters and gets mangled when copied on a
phone. Any static host works; a link shortener would hand the URL to a third party for no gain.
The authorization code lands on `127.0.0.1` — a port on the operator's own machine — so no third
party ever sees it, and the PKCE verifier never leaves the server.

Publishing with `gmail.*`, `drive` and `calendar` scopes is a **restricted/sensitive** scope set.
Google only drops the "unverified app" warning after verification (restricted scopes also need a
security assessment). For a single-account personal tool that warning is acceptable: click
**Advanced → Go to (unsafe)** on the consent screen. Verification is what removes the warning,
not what makes the token last.

## Verify the fix — do not trust it until 8 days pass

The only honest test is time: the current token must survive past its 7-day mark.

```bash
# daily at 08:00, already installed
journalctl --user -u gog-token-keepalive.service -n 5 --no-pager
tail -5 ~/.pi/agent/logs/gog-token-keepalive.log   # OK lines must keep coming after day 7
cat ~/.pi/agent/logs/gog-token-keepalive.streak    # must stay 0
```

Also confirm the token is not being re-created behind your back:

```bash
cd ~ && set -a && . ~/.pi/agent/.env && set +a
gog auth list --json | grep created_at   # must stay the consent date, not today
```

## Fallback if publishing is refused

Keep the app in Testing and re-consent every 6 days — a refresh token in Testing dies at 7.
In that case:

- the keepalive probe already alarms on Telegram when the probe starts failing;
- add a repeating calendar reminder every 6 days for the re-consent, following
  `docs/runbooks/gog-add-tasks-scope.md` (the two-step remote flow);
- never let the token get to day 8 on a day you actually need Calendar or Tasks.

## Related

- `docs/runbooks/gog-add-tasks-scope.md` — the re-consent procedure and its traps.
- `docs/runbooks/gog-token-keepalive.md` — the daily probe that catches this.

## Status after 2026-11-18

- App published to **In production** on project `257469568858`; branding filled with the three
  `uttdty.com/static/pi-agent*.html` pages.
- Re-consented at **2026-11-18T11:50:37Z** so the live token is minted in production mode rather
  than testing (the 11:04 token would still have died on 2026-11-25).
- Verified after the swap: `gog auth list` shows the five services, Calendar/Tasks/Drive read
  back, `scripts/gog-token-keepalive.sh` prints `OK` and the streak resets to 0.
- **Open proof: keepalive must still print `OK` on 26 Nov 2026.** Anything before that date does
  not demonstrate anything, because the testing-mode token also ran fine for its first week.
- The 15–18 Nov alarms did reach Telegram (`journalctl --user -u gog-token-keepalive` shows
  `alarm sent to 6363173838` for each failed morning), so the tripwire works; what failed was
  reacting to it.
