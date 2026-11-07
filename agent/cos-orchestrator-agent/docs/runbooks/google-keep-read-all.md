# Reading and writing Google Keep from the terminal (`keep-cli`)

> Removed 2026-11-07. Do not restore. The steps below are the record of the tool that was deleted with keep-agent. Do not run them.

The tool belongs to **keep-agent**, which is the agent that runs it:

- script: `~/.pi/agent-keep-agent/keep-agent/scripts/keep_cli.py`
- command: `~/.local/bin/keep-cli` → symlink to that script (unchanged name: `keep-cli --read-all-items`)
- contract entry: `~/.pi/agent-keep-agent/keep-agent/docs/CALLING.md` → "Keep CLI"
- credentials: `~/.config/keep-cli/credentials.json` (mode 600) — deliberately outside the
  agent home so rebuilding that home does not lose the login

This runbook stays here, in the orchestrator's docs, because keep-agent keeps no docs/ folder
except its contract. It now documents a tool it does not own; edit the script, not this page,
when behaviour changes.

Stdlib only, plus `cryptography` for the optional email+password login.

### Move record (2026-11-06)

| What | From | To |
| --- | --- | --- |
| script | `cos-orchestrator-agent/.../scripts/keep_cli.py` | `agent-keep-agent/keep-agent/scripts/keep_cli.py` |
| command | `~/.local/bin/keep-cli` symlink | repointed at the keep-agent copy (same name, same flags) |
| contract | — | `agent-keep-agent/keep-agent/docs/CALLING.md` "Keep CLI" + `AGENTS.md` environment bullet |
| manifest | — | `agent-keep-agent/keep-agent/agent.json` `purpose` now names `keep-cli` |
| runbook | this file | stayed here (keep-agent has no docs/ folder by design) |
| credentials | `~/.config/keep-cli/credentials.json` | unmoved — account-scoped, not agent-scoped |

Verified after the move: `keep-cli --self-test` 11/11, `keep-cli --check` answered for
`neopmpmtj@gmail.com`, and a `pi-keep-agent` turn ran `keep-cli --read-all-items` and returned
`1 entry:` with the note header — so the executing agent, not the orchestrator, now owns it.

```bash
keep-cli --self-test                     # offline parser check, no credentials
keep-cli --login                         # store a master token (password)
keep-cli --email you@gmail.com --web-token "oauth2_4/..."   # 2FA-safe: browser cookie
keep-cli --read-all-items                # print every entry
keep-cli --get=#2 --search milk          # one entry / search
keep-cli --rows [--list Groceries]       # checkbox rows with #entry:row addresses
keep-cli --item-add "butter" --list Groceries   # append a row to an existing list
keep-cli --check=#1:2 / --uncheck=#1:2   # tick / untick one row
keep-cli --count                         # entry count only (was --check)
keep-cli --add "body" --title T          # create a note
keep-cli --add-list --title T --item a   # create a list
keep-cli --trash=#2 / --restore=#2       # bin / un-bin
keep-cli --add "x" --dry-run             # show the payload, send nothing
keep-cli --read-all-items --json         # same, machine-readable
keep-cli --read-all-items --include-trashed --no-archived --limit 20
keep-cli --check                         # entry count only
keep-cli --read-all-items --raw           # dump the raw API payload
```

Credentials live in `~/.config/keep-cli/credentials.json` (mode 600, override with
`--credentials` or `$KEEP_CLI_CREDENTIALS`): `email`, `master_token`, `android_id`, plus a
cached `access_token` whose lifetime is ~1 h. Environment alternatives:
`KEEP_EMAIL`, `KEEP_MASTER_TOKEN`, `KEEP_CLI_CREDENTIALS`.

## Which API can actually read your notes

| API | Base | Accounts it works for | Read call |
| --- | --- | --- | --- |
| Official *Google Keep API* v1 | `https://keep.googleapis.com/v1` | **Workspace domains only**, service account + domain-wide delegation. Not for `@gmail.com`. | `GET /v1/notes`, `GET /v1/notes/{id}` |
| Internal mobile API (Android app, `gkeepapi`) | `https://www.googleapis.com/notes/v1` | **Any Google account**, with a master token | `POST /changes` |

`gog keep` is the *Workspace* one (`gog keep list`), so it cannot serve a personal account —
and this machine's only `gog` account (`neopmpmtj@gmail.com`) is personal. Hence the second row.

### Endpoints this script uses

1. **Token exchange** — `POST https://android.clients.google.com/auth`,
   `application/x-www-form-urlencoded`, `User-Agent: GoogleAuth/1.4`:

   ```
   accountType=HOSTED_OR_GOOGLE
   Email=<account>
   has_permission=1
   EncryptedPasswd=<master token, aas_et/...>
   service=oauth2:https://www.googleapis.com/auth/memento https://www.googleapis.com/auth/reminders
   source=android
   androidId=<16 hex digits, stable per account>
   app=com.google.android.keep
   client_sig=38918a453d07199354f8b19af05ec6562ced5788
   device_country=us  operatorCountry=us  lang=en  sdk_version=17
   google_play_services_version=240913000
   ```

   Response is `Key=value` lines; `Auth=` is the access token. Failure returns
   `Error=BadAuthentication` (403). Source: `gpsoauth/build_oauth_data()`.

2. **Read all notes** — `POST https://www.googleapis.com/notes/v1/changes`,
   `Authorization: OAuth <access token>`:

   ```json
   {
     "nodes": [],
     "clientTimestamp": "2026-11-05T12:00:00.000000Z",
     "requestHeader": {
       "clientSessionId": "s--<epoch_ms>--<random>",
       "clientPlatform": "ANDROID",
       "clientVersion": {"major":"9","minor":"9","build":"9","revision":"9"},
       "capabilities": [{"type":"NC"},{"type":"PI"},{"type":"LB"},{"type":"AN"},
                        {"type":"SH"},{"type":"DR"},{"type":"TR"},{"type":"IN"},
                        {"type":"SNB"},{"type":"MI"},{"type":"CO"}]
     },
     "targetVersion": "<from the previous response, omitted on the first call>"
   }
   ```

   Response: `{"nodes": [...], "userInfo": {"labels": [...]}, "toVersion": "...",
   "truncated": bool}`. Repeat with `targetVersion = toVersion` while `truncated` is true.
   `forceFullResync` / `upgradeRecommended` mean "start over" / "your client is old".

3. **Blobs (attachments/drawings)** — `https://keep.google.com/media/v2/<parentServerId>/<serverId>`
   (not used here; this script only reports attachment mime types).

### Node shapes

- `NOTE` / `LIST` are the top-level nodes (`parentId: "root"`).
- The body of a `NOTE` is **not** on the note: it is a child `LIST_ITEM` with
  `parentId = <note id>`. Same for `LIST` items, ordered by `sortValue`, nesting by
  `superListItemId`.
- A node without `parentId` in a `/changes` page means **deleted**.
- `timestamps`: `created`, `updated`, `userEdited`, `trashed`, `deleted`
  (`%Y-%m-%dT%H:%M:%S.%fZ`); `trashed` present = in the bin, `deleted` present = gone.
- `isArchived`, `isPinned`, `color`, `labelIds` → names via `userInfo.labels`,
  `annotationsGroup.annotations[].webLink` for links, `BLOB` children for attachments.

## Writing: creating and trashing entries

The Android client has no separate "create" call for notes — it uploads new nodes through the
same `POST /changes`, with a **client-generated id** and no `serverId`/`baseVersion`. The
server answers with the assigned `serverId` and `baseVersion`, and the node is live.

What the server refuses, learned the hard way (each of these gives `500 Unknown Error`, no
field name in the message):

| Field | Must be |
| --- | --- |
| `LIST_ITEM.superListItemId` | `null` — an empty string `""` is rejected |
| `LIST_ITEM.parentServerId` | `null` for a new row (the server fills it), not the parent's id |
| `timestamps` | `created`, `updated` **and `userEdited`** (6-digit fraction is fine) |
| `sortValue` | an integer (the server echoes it back as a string) |
| note body | a child `LIST_ITEM` with `parentId` = note id; the note's own `text` stays `""` |

Verified by diffing against payloads generated by the real `gkeepapi` (`node.Note().save()`),
which is the only reliable ground truth for this undocumented API: build the node with
`build_nodes()` and compare key-for-key. `keep-cli --add ... --dry-run` prints the payload;
`--self-test` asserts these shapes offline.

| `LIST_ITEM.parentServerId` on a row appended to an **existing** list | the list's `serverId` (gkeepapi sets `parent_server_id = list.server_id`); `null` only for rows of a brand-new list |
| `checked` on a row | boolean; ticking also bumps `updated` and `userEdited`, which is what makes the app show it as recently changed |

Row addressing: `--check=#1:2` (row 2 of the 2nd entry), `--check=Groceries:2`, `--check=<row id>`,
or a bare `#1`/list title for row 1. `--rows` prints the addresses and ids.

Trash/restore is the same path with `timestamps.trashed` set (or `1970-01-01T00:00:00.000Z` for
restore), sent back as a canonical edit carrying the node's `baseVersion`.

## Getting a master token

Only needed once; it is long-lived (`aas_et/...`) and has **full access to the account**.

### Route A — browser cookie (works on 2FA accounts, recommended)

1. Open <https://accounts.google.com/EmbeddedSetup> in a browser, signed out of every other
   Google account (or use a private window).
2. Sign in with the account and accept the terms.
3. When the page settles on the "account setup" screen, open devtools →
   **Application (Firefox: Storage) → Cookies → `https://accounts.google.com`**.
4. Copy the value of the **`oauth_token`** cookie — it starts with `oauth2_4/`.
5. Exchange it immediately (it expires within minutes):

   ```bash
   keep-cli --email you@gmail.com --web-token 'oauth2_4/...'
   ```

   That posts `ACCESS_TOKEN=1&Token=<cookie>` to `android.clients.google.com/auth`
   (`gpsoauth.exchange_token`) and stores the returned `Token=oauth2rt_...` master token.

### Route B — email + password

```bash
keep-cli --login --email you@gmail.com
```

Posts the Android RSA-OAEP login blob (same as `gkeepapi`'s `Keep.login`): `EncryptedPasswd`
is `b"\x00" + sha1(key_struct)[:4] + RSA-OAEP-SHA1(email \0 password)` against the public
key shipped with Google Play Services 7.3.29. **Accounts with 2FA are refused** by design
(`Error=BadAuthentication`, HTTP 403) — the same answer a wrong password gets, which is why
route A exists.

### Route C — token from a signed-in Android device

Extract `oauth_token` / `oauth2rt` from the device (or from `gkeepapi`'s embedded-browser
flow), then use `--web-token` for an `oauth_4/…` value, or write an `aas_et/…` master token
directly into `~/.config/keep-cli/credentials.json`.

### Trouble with `--login`

| What you see | Meaning / fix |
| --- | --- |
| `Error=BadAuthentication` (403) even with the right password | 2FA or captcha on the account; password login is dead for it. Use route A |
| `Error=NeedsBrowser` / `CaptchaRequired` | same — route A |
| `Error=ServiceDisabled` | Keep is off for this account |
| `"Request had invalid authentication credentials"` on a read | master token fine, access token expired — rerun, it re-exchanges and retries |
| traceback ending in `HTTP Error 403: Forbidden` | bug in this script, fixed 2026-11-06: the 403 body was discarded instead of parsed, and the RSA blob was re-encoded as UTF-8 instead of raw bytes |

`KEEP_CLI_DEBUG=1` appends the raw auth response to the error.

## Caveats

- The internal API is undocumented and can change without notice; the `x-gkeepapi` user
  agent is not used here, so Google treats this client as an unknown Android client.
- Reading only by default: `--read-all-items`, `--get`, `--search`, `--check` never write.
  The write commands (`--add`, `--add-list`, `--trash`, `--restore`) touch a real Google account;
  trashing is reversible from Keep's bin, and `--dry-run` shows the payload before sending.
- `--get=#2` / `--trash=#2`: a bare `#2` after a space is a bash comment, hence the `=` form.
- Rate limits: HTTP 429 is retried with backoff (up to 4 attempts).
- `--self-test` (11 checks) proves the parser without touching the network.

## Status of this machine

Signed in as `neopmpmtj@gmail.com` (master token stored 2026-11-06). `keep-cli --check` reports
3 top-level entries — 1 live note ("Hi, this is my first note", drawing attachment) and 2 in the
bin — so the account is effectively empty and the counts are real, not truncated. The auth and
read endpoints were also verified while unauthenticated: a fake master token returns
`403 Error=BadAuthentication` from `android.clients.google.com/auth`, and a fake access token
returns `401` from `notes/v1/changes`.
