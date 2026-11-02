# Deploying a new Google account for `gog`

For a fresh machine or a fresh Google account. Everything here is the `gog` CLI; the agent
just calls `gog`, so if this works in a shell it works in a session.

Paths are relative to the repo root (the directory holding `.env` and `sm-google-workspace/`).

## 0. Prerequisites

```bash
gog --version          # 0.34.0 or newer
which gog              # /home/<user>/.local/bin/gog
ls docs/               # this file
```

The repo copy needs its own launcher (it holds the absolute path to `.env` and to the `pi`
binary); see `pi-sm-google-workspace` for the template.

## 1. Google Cloud project

1. <https://console.cloud.google.com/> → create a project.
2. **APIs & Services → Library** → enable, for the services you will actually use in step 4:
   - Drive API (`drive`, `docs`, `sheets`, `slides`, `sites`)
   - Docs API, Sheets API, Slides API (only if you pass those services)
   - any other API named in `gog auth services`
3. **APIs & Services → OAuth consent screen**:
   - User type **External** (personal Gmail) — Internal only exists in Workspace.
   - Fill app name + support email, save.
   - **Test users**: add the target account, e.g. `newuser@gmail.com`, while the app is in
     Testing. Testing apps expire refresh tokens after **7 days** — publish to Production when
     the app is stable, or expect to re-authorize weekly (step 4).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type **Desktop app**. This is the simplest: Google permits any loopback
     redirect (`http://127.0.0.1:<any port>`) without registering ports.
   - **Web application** also works, but then register
     `http://127.0.0.1:8899/oauth2/callback` under *Authorized redirect URIs* and keep
     `--listen-addr 127.0.0.1:8899` in step 4.
   - **Download JSON**. That file is a client id + secret, not an account login.

## 2. Store the client credentials in `gog`

Use the encrypted file keyring, not the desktop keyring: on a headless or agent shell there is
no D-Bus SecretService, and `gog` fails with `keyring connection timed out after 10s`.

```bash
gog config set keyring_backend file
GOG_KEYRING_PASSWORD='<long passphrase>' gog auth credentials set ~/Downloads/client_secret_XXXX.json
```

`gog` splits the file: the client id goes to `~/.local/share/gogcli/credentials.json`, the secret
goes to the keyring. Verify:

```bash
GOG_KEYRING_PASSWORD='<passphrase>' gog auth credentials list
# CLIENT   PATH                                              SECRET_KEYRING
# default  /home/<user>/.local/share/gogcli/credentials.json  true
```

To keep the secret in an env var instead of the keyring, feed `gog` a credentials file whose
values are placeholders and add `--expand-env`:

```bash
printf '%s' '{"installed":{"client_id":"${GOOGLE_CLIENT_ID}","client_secret":"${GOOGLE_CLIENT_SECRET}"}}' \
  | gog auth credentials set - --expand-env
```

## 3. `.env`

In the repo root, `chmod 600 .env`:

```
DEEPSEEK_API_KEY=…
GEMINI_API_KEY=…
GOG_ACCOUNT=newuser@gmail.com
GOG_KEYRING_PASSWORD=<same passphrase as step 2>
```

`GOG_ACCOUNT` is what every `gog` call uses when no `--account` is given; without it you get
`missing --account`. `GOG_KEYRING_PASSWORD` is required in any non-interactive shell — the TUI's
bash tool has no TTY, so `gog` cannot prompt. `GOG_KEYRING_BACKEND` is not needed once
`gog config set keyring_backend file` has run. `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are
**not** read by `gog` — only the step 2 store is.

The launcher reads `.env` once at start; edit it between sessions, not during one.

## 4. Authorize the account

Desktop machine with a browser on the same host — `gog` opens the browser and finishes the
redirect itself:

```bash
GOG_KEYRING_PASSWORD='<passphrase>' gog auth add newuser@gmail.com \
  --services drive,docs,sheets \
  --drive-scope full \
  --force-consent \
  --listen-addr 127.0.0.1:8899 \
  --timeout 10m
```

Successful run prints `Authorization received. Finishing…` then the email, services and client.
If the browser does not open, copy the printed `https://accounts.google.com/o/oauth2/auth?…`
URL exactly — a wrapped line inserts `%20` and Google answers HTTP 400.

Headless machine (no browser on the box) — two steps, no paste-prone TUI:

```bash
# 1: print the URL, open it on any machine
gog auth add newuser@gmail.com --services drive,docs,sheets --drive-scope full \
  --force-consent --listen-addr 127.0.0.1:8899 --remote --step 1
# open the printed URL, approve; the browser lands on 127.0.0.1:8899 and shows an error page
# 2: paste that whole redirect URL back
gog auth add --services drive,docs,sheets --drive-scope full --force-consent \
  --remote --step 2 --auth-url 'http://127.0.0.1:8899/oauth2/callback?state=…&code=…'
```

Useful flags: `--readonly` (read-only scopes and blocks writes), `--drive-scope readonly|file`,
`--client NAME` (second OAuth client, separate token bucket), `--account` on any command.

## 5. Verify before handing over to an agent

```bash
export GOG_ACCOUNT=newuser@gmail.com GOG_KEYRING_PASSWORD='<passphrase>'
gog auth list                                  # account + granted services
gog drive ls --no-input --plain | head         # reads Drive root
gog drive search report --no-input --json --results-only | head
```

Then a live check through the real entry point:

```bash
pi-sm-google-workspace -p "List all folders in my gdrive root"
```

## 6. What lives where

| Path | Contents |
| --- | --- |
| `~/.config/gogcli/config.json` | keyring backend (`file`) |
| `~/.local/share/gogcli/credentials.json` | OAuth client id (secret is in the keyring) |
| `~/.local/share/gogcli/keyring/token:default:<email>` | refresh token for client `default` — the file actually read |
| `~/.local/share/gogcli/keyring/client/default/client-secret` | OAuth client secret |
| `~/.local/share/gogcli/keyring/token:<email>`, `token-sub:…` | legacy/bucket-index mirrors, not read |

None of this is portable: a new machine needs steps 2 and 4 again with its own keyring password.

## 7. Failures and what they mean

| Message | Cause | Fix |
| --- | --- | --- |
| `missing --account` | `.env` not loaded, or `GOG_ACCOUNT` unset | source `.env`, relaunch the agent |
| `no TTY available … set GOG_KEYRING_PASSWORD` | passphrase missing in the environment | add it to `.env` / export it |
| `keyring connection timed out after 10s` | backend fell back to SecretService | `gog config set keyring_backend file` |
| `invalid_grant` | refresh token revoked or expired (Testing apps: 7 days) | re-run step 4 |
| `deleted_client` | OAuth client removed in Cloud Console | create a new client, redo steps 2 and 4 |
| `invalid_client` / `unauthorized_client` | wrong secret, or redirect URI not registered | re-store credentials, check step 1.4 |
| `access_denied` on the consent screen | account missing from Test users | add it, or publish the app |
| `HTTP 400` on the auth URL | URL copied with inserted spaces | use `--listen-addr` flow, do not reflow the URL |
