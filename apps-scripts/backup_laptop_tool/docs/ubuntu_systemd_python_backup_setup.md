# Ubuntu systemd setup for the Pi Backup Tool

How the backup runs on this laptop (Ubuntu) via systemd, with a venv.
See `README.md` for the full architecture.

- **What gets backed up:** `~/.pi` (set as `WorkingDirectory` in the unit).
- **Entry point:** `python -m backup_PC_tool.main` (package in `src/backup_PC_tool/`).
- **Virtualenv:** `.venv/` at the repo root
  (`/home/pmpmt/.pi/apps-scripts/backup_laptop_tool/.venv`).
- **Schedule:** `OnBootSec=5min`, `Persistent=true` (catches missed boots).

## Config files

- **`~/.pi/agent/.env`** — OAuth client id/secret and Drive-related options
  (copy values from `.env.example` in this repo). This file is gitignored and
  sourced by the `pi` wrapper.
- **`src/backup_PC_tool/backup_config.json`** — **`blacklist` only** (copy from
  `backup_config.json.example.json`). Must include `node_modules`, `.venv`,
  `.git`, `__pycache__`, `.backup_PC_cache`, etc.

**Logs:** journald (`journalctl -u my_PC_backup.service`) and the file
`src/backup_PC_tool/backup.log`.

## Install

```bash
sudo cp /home/pmpmt/.pi/apps-scripts/backup_laptop_tool/my_PC_backup.service \
        /home/pmpmt/.pi/apps-scripts/backup_laptop_tool/my_PC_backup.timer \
        /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now my_PC_backup.timer
```

Manual one-shot:

```bash
sudo systemctl start my_PC_backup.service
```

Status:

```bash
systemctl status my_PC_backup.service
systemctl status my_PC_backup.timer
journalctl -u my_PC_backup.service -n 200 --no-pager
```

## The unit files

### `/etc/systemd/system/my_PC_backup.service`

```ini
[Unit]
Description=Google Drive snapshot backup of ~/.pi
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=pmpmt
Group=pmpmt

WorkingDirectory=/home/pmpmt/.pi

Environment=BACKUP_INTERACTIVE=0
Environment=BACKUP_TRIGGER=boot
Environment=PYTHONPATH=/home/pmpmt/.pi/apps-scripts/backup_laptop_tool/src

ExecStart=/home/pmpmt/.pi/apps-scripts/backup_laptop_tool/.venv/bin/python -m backup_PC_tool.main

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/home/pmpmt

TimeoutStartSec=60min

[Install]
WantedBy=multi-user.target
```

### `/etc/systemd/system/my_PC_backup.timer`

```ini
[Unit]
Description=Run my_PC_backup.service 5 minutes after boot

[Timer]
OnBootSec=5min
Persistent=true
AccuracySec=1min
Unit=my_PC_backup.service

[Install]
WantedBy=timers.target
```

## Dashboard service

The web dashboard is served by the Node main dashboard:

```bash
sudo systemctl enable --now pi_main_dashboard.service     # node :3000
```

The backup UI lives at `http://localhost:3000/backup`. There is no separate
Python dashboard service anymore (the former `pi_backup_dashboard.service`
running `dashboard.py` on `:8765` has been retired; the Node server now serves
the dashboard natively and invokes this Python engine as a subprocess for
backups and OAuth).

## First-time OAuth authorization

Run once interactively so the browser flow can write the token file:

```bash
cd /home/pmpmt/.pi/apps-scripts/backup_laptop_tool
BACKUP_INTERACTIVE=1 PYTHONPATH=src .venv/bin/python -m backup_PC_tool.main
```

Or click **🔑 Re-authorize Google** in the dashboard
(`http://localhost:3000/backup`). After this, the systemd timer can run
non-interactively.

## Troubleshooting

- **Timer never fires:** `systemctl list-timers --all | grep backup` and check
  `OnBootSec`/`Persistent`.
- **`ConfigError: GOOGLE_CLIENT_ID ... must be set`:** the `.env` at
  `~/.pi/agent/.env` is missing or not sourced. The pi wrapper sources it with
  `set -a`; the config loader reads that `.env` via `python-dotenv`.
- **OAuth revoked / token expired:** re-run the interactive authorization step.
- **Backups too large:** ensure `node_modules`, `.venv`, `.git` are in
  `backup_config.json`'s `blacklist`. The dashboard's *Blacklist* card shows the
  current list.
- **`ReadWritePaths=/home/pmpmt`** covers both the snapshotted tree (`~/.pi`)
  and the tool dir (token, log, cache, db) under `~/.pi/apps-scripts`.
