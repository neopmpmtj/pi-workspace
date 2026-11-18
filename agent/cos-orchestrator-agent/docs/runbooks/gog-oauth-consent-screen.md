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
