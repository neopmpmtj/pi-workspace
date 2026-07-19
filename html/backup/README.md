# Pi Backup Dashboard (Node)

Native Node.js backup dashboard, served by `~/.pi/html/server.mjs` on port `:3000`.

## Why this layout

The dashboard frontend is plain static files (`index.html` / `style.css` /
`app.js`) and the REST API is a native Node module (`api.mjs`). This keeps the
JS in real files that `node --check` and editors can validate.

The Python backup **engine** (`snapshot.py`, `gdrive.py`, `auth.py`, `db.py`,
`main.py`, at `~/.pi/apps-scripts/backup_laptop_tool/`) is unchanged — Node
invokes it as a subprocess. The official `google-api-python-client` / OAuth
flow stays in Python where it belongs.

A second win: Node's event loop is naturally non-blocking, so a long OAuth
authorization (`POST /api/auth`) or a running backup cannot stall other
requests — no `ThreadingHTTPServer` or async-job lock required.

## Layout

```
~/.pi/html/backup/
├── index.html      # page structure (links style.css + app.js)
├── style.css       # all styling (was inline <style>)
├── app.js          # all client JS (was inline <script>)
├── api.mjs         # REST API handlers, imported by server.mjs
├── README.md       # this file
└── test/
    └── api.test.mjs # unit tests (node --test)
```

`server.mjs` wires the routes:

| Path | Served by |
|------|-----------|
| `/backup/` | `index.html` (static) |
| `/backup/style.css`, `/backup/app.js` | static assets |
| `/backup/api/*` | `handleBackupApi()` in `api.mjs` |

## REST API

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/api/settings` | Settings + token status + hostname |
| POST | `/api/settings` | Save settings and/or blacklist |
| GET  | `/api/log?lines=N` | Tail of `backup.log` |
| GET  | `/api/history?limit=N` | Recent runs (newest first) |
| GET  | `/api/history?id=N` | Single run incl. captured log |
| GET  | `/api/stats` | 30-day success/failure summary |
| POST | `/api/backup` | Start a backup (non-blocking) |
| GET  | `/api/backup/status` | Poll the running backup (result returned once) |
| POST | `/api/auth` | Re-run with `BACKUP_INTERACTIVE=1` (OAuth) |

The contract is identical to the former Python dashboard (verified by parity
tests). `app.js` derives `API_BASE` from `window.location.pathname`, so it works
at any prefix without code changes.

## Run the tests

```bash
cd ~/.pi/html/backup
node --test            # 22 unit tests, ~0.1s, no deps, no network
node --check app.js    # syntax-check the client JS
node --check api.mjs   # syntax-check the API module
```

The tests inject a fake `spawn` (via `_setSpawnEngine`) so the Python engine is
never invoked. They cover: dotenv parse/write round-trips, boolean env parsing,
and the async backup job state machine (start → running → complete, double-start
rejection, failure handling, result-returned-once, rejected-spawn guard).

The Python engine's own tests live in
`~/.pi/apps-scripts/backup_laptop_tool/` (`python -m pytest`, 101 tests) and are
unaffected by this move.
