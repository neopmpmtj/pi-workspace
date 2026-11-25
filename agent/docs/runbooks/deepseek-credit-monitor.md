# DeepSeek credit monitor — never run out mid-job

**Trigger:** API credit is prepaid. When it hits zero the agent stops mid-conversation with no
warning. The user wants to be told *before* that, not after.

**Status:** live on the VPS 2026-11-25 — `deepseek-credit-monitor.timer`, every 30 minutes,
verified with a real Telegram send.

---

## 1. What it does

`agent/scripts/deepseek-balance.sh` reads `GET /user/balance`. That endpoint is **free**: it is
account metadata, not a model call, so it costs no tokens and no credit. Only chat traffic
spends money.

`agent/scripts/deepseek-credit-monitor.sh` wraps it with a two-threshold alarm and hysteresis:

| Balance | Band | What the user gets |
| --- | --- | --- |
| ≥ USD 2.50 | `ok` | nothing |
| USD 2.00 – 2.50 | `warn` | **one** heads-up, then quiet |
| < USD 2.00 | `crit` | an alert **every 30 min** until topped up |
| check failed | `error` | **one** alert, then quiet |
| band returns to `ok` | — | **one** recovery line |

The alert goes straight to the Telegram Bot API (`sendMessage`), so it costs no model turn and
still works when the pi agent is stopped or the machine is just idling.

State lives in `agent/state/deepseek-credit.json` (per host, gitignored):
`{"band","total","checked_at","notified_at"}`. It is what makes `warn` speak once and `crit`
repeat, and it is deleted-safe: a missing file means "assume ok and speak on the next change".

## 2. Files

| Path | Role |
| --- | --- |
| `agent/scripts/deepseek-balance.sh` | one-line balance, `--json`, `--min N`, `--quiet` |
| `agent/scripts/deepseek-credit-monitor.sh` | thresholds, state, Telegram send, `--dry-run`, `--force`, `--self-test` |
| `scripts/systemd/deepseek-credit-monitor.service` + `.timer` | 30-minute schedule, installed under `~/.config/systemd/user` |
| `agent/prompts/balance.md` | `/balance` — on-demand check from Telegram or the TUI |

## 3. Run and verify

```bash
~/.pi/agent/scripts/deepseek-balance.sh                  # USD 7.56 … available: yes
~/.pi/agent/scripts/deepseek-credit-monitor.sh --dry-run # band, action, message preview
~/.pi/agent/scripts/deepseek-credit-monitor.sh --self-test  # one real Telegram message

systemctl --user list-timers deepseek-credit-monitor.timer --all
journalctl --user -u deepseek-credit-monitor -n 20 --no-pager
```

The journal line is the audit trail: `band=ok total=7.56 prev=ok action=silent`.

Test a band without waiting for the real balance, by moving the thresholds:

```bash
DEEPSEEK_WARN_USD=8 DEEPSEEK_CRIT_USD=7.9 ~/.pi/agent/scripts/deepseek-credit-monitor.sh --dry-run
```

## 4. Install / uninstall

```bash
cp ~/.pi/scripts/systemd/deepseek-credit-monitor.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now deepseek-credit-monitor.timer

# off
systemctl --user disable --now deepseek-credit-monitor.timer
```

No sudo and no root unit: the check is a user job, and the VPS already has `linger=yes`, so it
runs without a login.

## 5. Tuning

| Knob | Default | Effect |
| --- | --- | --- |
| `DEEPSEEK_WARN_USD` | `2.50` | recovery line: at or above this, alerts stop |
| `DEEPSEEK_CRIT_USD` | `2.00` | repeat line: below this, alert every run |
| `DEEPSEEK_ALERT_CHAT` | owner id from `telegram.json` | where alerts go |
| `DEEPSEEK_ENV_FILE` | `~/.pi/agent/.env` | where the bot token is read from |
| `DEEPSEEK_MONITOR_STATE` | `agent/state/deepseek-credit.json` | state file |

Change the cadence in the `.timer` only: `OnCalendar=*:0/30` → `*:0/15` etc., then
`systemctl --user daemon-reload && systemctl --user restart deepseek-credit-monitor.timer`.

## 6. Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| alerts stop entirely | timer disabled or not enabled after a reboot | `systemctl --user list-timers …`, `enable --now` |
| "balance check failed" alert | key revoked, network, DeepSeek 5xx | run `deepseek-balance.sh` by hand; a 401 means the key in `.env` |
| repeated "credit back" lines | stale state file copied from another host | delete `agent/state/deepseek-credit.json` |
| alert but the agent answers fine | normal — a warning is meant to arrive before zero | top up; the recovery line arrives on the next run |
