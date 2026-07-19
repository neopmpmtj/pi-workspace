# Pi Backup Tool

Snapshots `~/.pi` to **Google Drive** on a schedule, with a local web dashboard
for triggering backups, editing settings, and reviewing history.

## Architecture

```
            ┌──────────────────────────────────────────────┐
  browser ──▶│ Node server.mjs  :3000                       │
            │   main dashboard + token-tracker + /backup   │
            │   /backup        → static HTML/CSS/JS         │
            │   /backup/api/*  → api.mjs (sqlite, .env)     │
            │   /backup/api/backup → spawn python engine    │
            └──────────────────────────────────────────────┘
                              │ subprocess (only for the heavy lifting)
                              ▼
            ┌──────────────────────────────────────────────┐
            │ python -m backup_PC_tool.main  (this package) │
            │   tar.gz snapshot → Drive, OAuth, history     │
            └──────────────────────────────────────────────┘
```

Two layers, each doing what it's best at:

- **Node** (`~/.pi/html/`) — the web layer. Serves the dashboard UI as real
  static files (`index.html` / `style.css` / `app.js`) and a small JSON REST API
  (`backup/api.mjs`). Its event loop is naturally non-blocking, so a long OAuth
  flow or a running backup cannot stall other requests.
- **Python** (this package) — the backup *engine*. Uses the official
  `google-api-python-client` / `google-auth-oauthlib` for OAuth + resumable
  uploads, `tarfile` for snapshots, `sqlite3` for history. Invoked as a
  subprocess by Node; also runs on a systemd timer.

The frontend used to be embedded as a string inside a Python `dashboard.py`
(running its own HTTP server on `:8765`, reverse-proxied through Node). That
design caused a class of bugs where Python string-escaping silently corrupted
the inline JS. It has been retired; see `~/.pi/html/backup/README.md`.

## Layout

| Path | Purpose |
|------|---------|
| `src/backup_PC_tool/main.py` | Snapshot + upload entry point (CLI / subprocess) |
| `src/backup_PC_tool/snapshot.py` | `tar.gz` creation with blacklist pruning |
| `src/backup_PC_tool/gdrive.py` | Drive upload + retention (retried, paginated) |
| `src/backup_PC_tool/auth.py` | OAuth (token stored in package dir) |
| `src/backup_PC_tool/config.py` | Loads `backup_config.json` + env |
| `src/backup_PC_tool/db.py` | SQLite run history (`backup_history.db`) |
| `src/backup_PC_tool/log.py` | Logging setup (stdout + `backup.log`) |
| `src/backup_PC_tool/backup_config.json` | **`blacklist` only** |
| `~/.pi/agent/.env` | Secrets + options (OAuth id/secret, folder, retention, …) |
| `.backup_PC_cache/` | Local archive cache (only newest kept) |
| `tests/test_gdrive.py` | gdrive unit tests (escape, pagination, retention, upload) |

The web dashboard lives separately at `~/.pi/html/backup/` (Node).

## Configuration

Secrets and tunables live in `~/.pi/agent/.env` (gitignored, sourced by the pi
wrapper). See `.env.example` for the full list:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (required)
- `GDRIVE_BACKUPS_FOLDER` (default `backups`)
- `USE_HOSTNAME_SUBFOLDER` (default `true` — per-machine subfolder on Drive)
- `TOKEN_FILE` (default `gdrive_token.json`, stored in the package dir)
- `RETENTION_COUNT` (default `0` = keep all; e.g. `5` keeps last 5 on Drive)

The **blacklist** (directory names skipped anywhere in the tree) is edited via
the dashboard or directly in `src/backup_PC_tool/backup_config.json`. It must
include regenerable/heavy dirs: `.git`, `venv`, `.venv`, `node_modules`,
`__pycache__`, `.mypy_cache`, `.pytest_cache`, `.backup_PC_cache`.

## systemd units

| Unit | Role |
|------|------|
| `my_PC_backup.timer` | Triggers `my_PC_backup.service` 5 min after boot |
| `my_PC_backup.service` | Runs `python -m backup_PC_tool.main` with `WorkingDirectory=/home/pmpmt/.pi`, `BACKUP_TRIGGER=boot` |
| `pi_main_dashboard.service` | Runs `server.mjs` on `:3000` (serves this dashboard at `/backup`) |

Source for the oneshot unit/timer is kept in this repo as
`my_PC_backup.service` / `my_PC_backup.timer`; the installed copies live in
`/etc/systemd/system/`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now my_PC_backup.timer
sudo systemctl start  my_PC_backup.service      # manual one-shot
journalctl -u my_PC_backup.service -n 200 --no-pager
```

## Running the engine manually

> **Important:** `main.py` backs up from `cwd` (the current working directory).
> Always `cd` to the directory you want to snapshot (in this case `~/.pi`).

```bash
# The snapshot source directory (must be cwd when the engine runs)
cd /home/pmpmt/.pi

# Activate the venv and set PYTHONPATH (use absolute paths since cwd changed)
source /home/pmpmt/.pi/apps-scripts/backup_laptop_tool/.venv/bin/activate
export PYTHONPATH=/home/pmpmt/.pi/apps-scripts/backup_laptop_tool/src

# non-interactive (uses cached OAuth token)
BACKUP_TRIGGER=cli /home/pmpmt/.pi/apps-scripts/backup_laptop_tool/.venv/bin/python -m backup_PC_tool.main

# first-time OAuth authorization (opens a browser)
BACKUP_INTERACTIVE=1 /home/pmpmt/.pi/apps-scripts/backup_laptop_tool/.venv/bin/python -m backup_PC_tool.main
```

Or just use the dashboard at `http://localhost:3000/backup`
(`▶ Run Backup Now` / `🔑 Re-authorize Google`).

## Tests

```bash
source .venv/bin/activate
.venv/bin/python -m pytest
```

`pytest.ini` sets `pythonpath = src .` and discovers tests under both
`src/backup_PC_tool/tests/` and the top-level `tests/` directory, so no
`PYTHONPATH` is needed. The project is not packaged (no `pyproject.toml`);
runtime dependencies come from `requirements.txt` and imports are resolved via
`PYTHONPATH=src` in the systemd unit / Node subprocess.

The Node dashboard has its own suite at `~/.pi/html/backup/` (`node --test`).

## Notes

- The package is named `backup_PC_tool` (carried over from the original "PC"
  desktop project). Renaming would touch the systemd unit, tests, and the Node
  subprocess invocation — left as-is intentionally to avoid disturbing the
  running services.
