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

```bash
~/pi-agents-experts-grouped/scripts/stop-dashboards.sh
~/pi-agents-experts-grouped/scripts/start-dashboards.sh
~/pi-agents-experts-grouped/scripts/restart-dashboards.sh
```

Logs: `~/pi-agents-experts-grouped/.dashboard-logs/`
