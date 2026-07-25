# Backup Tool — Service Account / OAuth Authentication Fix

**Date:** 2026-07-25
**System:** Ubuntu 24.04 (Pi, Custom Node Server, Python backup engine)
**Location:** `~/.pi/apps-scripts/backup_laptop_tool/src/backup_PC_tool/` (Python engine), `~/.pi/html/backup/` (Node API + dashboard), `~/.pi/agent/.env` (secrets)

---

## Problem

The Pi backup tool (dashboard at `http://localhost:3000/backup/`) was actively failing. Two distinct symptoms:

1. **Manual backup failed** — Clicking "Run Backup Now" created the `.tar.gz` snapshot but always failed on Google Drive upload with a `403` error: *"Service Accounts do not have storage quota. Leverage shared drives or use OAuth delegation."*

2. **Re-authorize Google failed** — Clicking "Re-authorize Google" showed "Authorization failed: unknown error" with no actionable diagnostics. The OAuth flow couldn't open a browser from the background subprocess.

The backup had been silently broken for days (last successful run was 2026-07-19), with no error visibility to the user.

---

## Investigation / Root Cause

### Problem 1: Service Account Blocking OAuth

The `.env` file contained `GOOGLE_SERVICE_ACCOUNT_KEY` pointing to a valid service account key file at `~/.pi/agent/secrets/service_account_key.json`. The auth chain in `auth.py` checked this path **first**:

```
get_drive_credentials(interactive)
  → sa_key_path = get_service_account_key_path()  // found the key file!
  → return _build_service_account_credentials(sa_key_path)  // OAuth never reached
```

The backup engine always used the service account — which had no Drive storage quota — and never fell through to the user OAuth token, even though a `gdrive_token.json` (with refresh token) existed.

### Problem 2: Stale Environment Poisoning

After removing `GOOGLE_SERVICE_ACCOUNT_KEY` from `.env`, the backup **still** used the service account. Investigation revealed the mechanism:

1. The pi wrapper (`~/.local/bin/pi`) shells the `.env` file with `set -a`
2. Those env vars propagate down: pi → Node server (server.mjs) → Python subprocess
3. When we restarted the Node server, it inherited the **shell's** environment — which still had `GOOGLE_SERVICE_ACCOUNT_KEY` set from the old `.env`
4. `load_dotenv()` in `config.py` **deliberately does not overwrite** variables already present in `os.environ`
5. Therefore, the removed key persisted indefinitely

`load_dotenv()` behavior: respects existing `os.environ` values. This is documented and intentional — it allows runtime overrides. But it means removing a key from `.env` doesn't clear it from a running process chain.

### Problem 3: Re-Authorization Flow Design

The "Re-authorize" button called `POST /api/auth`, which spawned `main.py` — the full backup engine — with `BACKUP_INTERACTIVE=1`. This is wrong on two levels:

1. **A full backup runs during auth** — snapshot creation, archive, then OAuth during upload. Takes longer, wastes resources.
2. **No separate auth-only entry point existed** — authentication was a side effect of `upload_snapshot()` calling `get_drive_service(interactive=True)` deep in the backup pipeline.

### Problem 4: Zero Error Diagnostics

The dashboard front-end (`app.js`) looked for `result.error` in the API response, but the Node API returned `{ success, stdout, stderr, exitCode }` from the subprocess — no `error` field. So every failure showed "unknown error" regardless of the actual cause.

### Problem 5: Token Revocation

The OAuth refresh token in `gdrive_token.json` had been revoked by Google (`invalid_grant`). This is typical: tokens expire or get revoked when unused, when the account password changes, or when the OAuth consent grant is removed. The `run_local_server()` flow in `google_auth_oauthlib` requires a working `BROWSER` (Python's `webbrowser` module) to complete the re-auth, but the subprocess environment lacked the proper `DISPLAY`/`XAUTHORITY` for Firefox.

---

## Architecture / Design Decisions

### Auth Path Before vs. After

| Aspect | Before | After |
|---|---|---|
| Auth priority | Service account (hard check) → OAuth | OAuth only (service account suppressed) |
| Re-auth button | Runs `main.py` (full backup + auth) | Runs `auth_cli.py` (auth-only) |
| Error surfacing | "unknown error" in toast | Actual stderr/stdout shown in status, log panel |
| Service account guard | `os.environ.get()` only | Env var is checked against `.env` file on disk |
| Stale env defense | None | Node explicitly deletes `GOOGLE_SERVICE_ACCOUNT_KEY` from subprocess env |

### Why the .env File Check in config.py

The key decision: `get_service_account_key_path()` now reads the `.env` file directly on every call to verify the key is still configured — not just present in `os.environ`. This is the permanent safety net:

```python
# Guard against stale inherited env vars:
env_path = Path.home() / ".pi" / "agent" / ".env"
if env_path.exists():
    env_text = env_path.read_text(encoding="utf-8")
    has_key = any(...)
    if not has_key:
        return None  # explicitly removed from .env
```

This means even if a parent process accidentally injects `GOOGLE_SERVICE_ACCOUNT_KEY` into the environment, the Python engine ignores it when the `.env` file on disk no longer defines it.

Alternative considered: deleting the env key inside `api.mjs` only. Rejected because that only fixes the Node-spawned path — if someone runs the backup manually from a shell with the stale env, it would still break. The Python-side guard is the definitive fix.

### auth_cli.py — Separate Auth Entry Point

Created `auth_cli.py` as a lightweight standalone script that does OAuth only:
- Tries to refresh existing token first
- Falls through to browser-based OAuth flow
- Saves the new token
- Prints diagnostic info (token path, DISPLAY, BROWSER)
- On failure, prints manual terminal auth instructions

No snapshot, no archive, no upload — just authentication.

---

## Implementation

### Phase 1 — Remove Service Account from Config

**File:** `~/.pi/agent/.env`

Removed the line:
```
GOOGLE_SERVICE_ACCOUNT_KEY=/home/pmpmt/.pi/agent/secrets/service_account_key.json
```

### Phase 2 — Python-Side Stale-Env Guard

**File:** `~/.pi/apps-scripts/backup_laptop_tool/src/backup_PC_tool/config.py`

Modified `get_service_account_key_path()` to cross-check the `.env` file on disk before honoring the env variable. If the key is absent from `.env`, returns `None` regardless of `os.environ`.

### Phase 3 — Node-Side Stale-Env Stripping

**File:** `~/.pi/html/backup/api.mjs`

Both `spawnEngine()` (backup route) and `runAuth()` (auth route) now construct the subprocess environment and explicitly `delete e.GOOGLE_SERVICE_ACCOUNT_KEY` before spawning.

Also added `BROWSER=firefox`, `DISPLAY`, and `XAUTHORITY` to the subprocess environment so the OAuth browser launch works.

### Phase 4 — Separate Auth Entry Point

**File:** `~/.pi/apps-scripts/backup_laptop_tool/src/backup_PC_tool/auth_cli.py` (NEW)

Standalone auth script. Used by the `POST /api/auth` route in `api.mjs` instead of `main.py`. Imports via absolute package paths (`backup_PC_tool.auth`, `backup_PC_tool.config`) to work correctly as `python -m backup_PC_tool.auth_cli`.

### Phase 5 — Better Error Diagnostics

**File:** `~/.pi/html/backup/api.mjs`

`runAuth()` now extracts the last line of stderr as `result.error` in the response JSON for non-success results.

**File:** `~/.pi/html/backup/app.js`

`runAuth()` in the front-end now:
- Uses `extractAuthError(result)` to find meaningful diagnostics from stderr/stdout
- Shows the error in the status bar **and** the history log detail panel
- Falls back to `exitCode` if no text output is available

### Phase 6 — Token Refresh

The OAuth flow in `auth_cli.py` successfully completed a fresh authorization (triggered by DeepSeek V4 model during testing). The new token was saved to `~/.pi/agent/secrets/gdrive_token.json`. A manual backup confirmed full pipeline success: snapshot → upload to Google Drive → cache cleanup → history recorded.

### Phase 7 — Clean Slate

Old log file (`~/.pi/.../backup.log`, 18MB) and history database (`backup_history.db`, 340KB) were deleted. Fresh copies will be created on the next backup run with clean data.

---

## Files Created/Modified

| File | Action | Purpose |
|---|---|---|
| `~/.pi/agent/.env` | Modified | Removed `GOOGLE_SERVICE_ACCOUNT_KEY` line |
| `~/.pi/apps-scripts/backup_laptop_tool/src/backup_PC_tool/config.py` | Modified | Cross-check `.env` file before using service account key |
| `~/.pi/apps-scripts/backup_laptop_tool/src/backup_PC_tool/auth.py` | Modified | Better error message when browser fails |
| `~/.pi/apps-scripts/backup_laptop_tool/src/backup_PC_tool/auth_cli.py` | **Created** (~120 lines) | Standalone OAuth-only entry point |
| `~/.pi/html/backup/api.mjs` | Modified | Stripe stale env vars; use `auth_cli.py` for auth route; add `error` field to response; pass DISPLAY/XAUTHORITY |
| `~/.pi/html/backup/app.js` | Modified | `extractAuthError()` helper; show error details in log panel |
| `~/.pi/agent/secrets/gdrive_token.json` | Updated | Fresh OAuth token from re-authorization |
