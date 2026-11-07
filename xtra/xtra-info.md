# Extra info

## Connectivity check

```bash
date -u
echo ---
curl -sS -m 8 -o /dev/null -w "%{http_code}\n" https://news.ycombinator.com/
```

## Local services

| What | URL |
| --- | --- |
| Orchestrator (page and API) | http://127.0.0.1:8787 |
| Image describer API | http://127.0.0.1:8788 |
| Web master (page and API) | http://127.0.0.1:8789 |
| Image describer page | http://127.0.0.1:5173 |

The project control plane (`:8786`) is not in this table. It is `control/server.ts`, started by hand. Port `:8790` is unused: keep-agent was removed on 2026-11-07 and must not be restored.

The scripts below are a leftover laptop helper. Nothing else calls them (only `restart-dashboards.sh` wraps start). They are not an agent registry. Do not add new siblings here; COS roster is `APPEND_SYSTEM.md`, settings/dashboard start is `control/agents.ts`.

```bash
~/.pi/xtra/bash-system-scripts/stop-dashboards.sh
~/.pi/xtra/bash-system-scripts/start-dashboards.sh
~/.pi/xtra/bash-system-scripts/restart-dashboards.sh
```

They boot only 8787, 8788, 8789, and 5173. Logs: `~/.pi/.dashboard-logs/`
