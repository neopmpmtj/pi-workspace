#!/usr/bin/env bash
# ============================================================
# deepseek-credit-monitor.sh — never run out of credit.
#
#   every 30 min (deepseek-credit-monitor.timer) it reads the balance and:
#     total >= $2.50          silent            (band: ok)
#     $2.00 <= total < $2.50  one warning       (band: warn)
#     total <  $2.00          alert every run   (band: crit, persistent)
#     check failed            one alert         (band: error)
#     band returns to ok       one recovery line
#
# The warning is sent with the Telegram Bot API directly: no model turn, no
# tokens, nothing added to the ledger.
#
#   deepseek-credit-monitor.sh --dry-run    show the band/action, send nothing
#   deepseek-credit-monitor.sh --force      send this band's message now
#   deepseek-credit-monitor.sh --self-test  send one "(self-test)" message
#
# Thresholds: DEEPSEEK_WARN_USD (2.50) and DEEPSEEK_CRIT_USD (2.00).
# State:      ~/.pi/agent/state/deepseek-credit.json (per host, gitignored).
# Exit: 0 handled | 1 balance check or Telegram send failed.
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BALANCE="$HERE/deepseek-balance.sh"
ENV_FILE="${DEEPSEEK_ENV_FILE:-$HOME/.pi/agent/.env}"
TELEGRAM_JSON="${TELEGRAM_JSON:-$HOME/.pi/agent/telegram.json}"
STATE="${DEEPSEEK_MONITOR_STATE:-$HOME/.pi/agent/state/deepseek-credit.json}"
WARN="${DEEPSEEK_WARN_USD:-2.50}"
CRIT="${DEEPSEEK_CRIT_USD:-2.00}"

DRY=0
FORCE=0
SELF_TEST=0
while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY=1; shift ;;
        --force) FORCE=1; shift ;;
        --self-test) SELF_TEST=1; shift ;;
        -h | --help) sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "deepseek-credit-monitor.sh: unknown argument: $1" >&2; exit 1 ;;
    esac
done

log() { printf '%s %s\n' "$(date -Is)" "$*"; }

# --- secrets: never printed, never in argv ---------------------------
env_value() { # env_value NAME FILE
    local name="$1" file="$2"
    [ -f "$file" ] || return 0
    sed -n "s/^[[:space:]]*${name}[[:space:]]*=[[:space:]]*//p" "$file" |
        tail -n 1 | sed 's/[[:space:]]*$//' |
        sed 's/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/'
}

TOKEN="${TELEGRAM_BOT_TOKEN:-$(env_value TELEGRAM_BOT_TOKEN "$ENV_FILE")}"
CHAT_ID="${DEEPSEEK_ALERT_CHAT:-$(jq -r '.profiles.default.allowedUserId // empty' "$TELEGRAM_JSON" 2>/dev/null || true)}"
CHAT_ID="${CHAT_ID:-6363173838}"

send_telegram() { # send_telegram TEXT
    if [ "$DRY" = 1 ]; then
        log "dry-run, would send: $1"
        return 0
    fi
    if [ -z "$TOKEN" ]; then
        log "ERROR no Telegram bot token in environment or $ENV_FILE"
        return 1
    fi
    local http
    http="$(curl -sS -m 20 -o /tmp/ds-credit-send.$$ -w '%{http_code}' \
        "https://api.telegram.org/bot${TOKEN}/sendMessage" \
        --data-urlencode "chat_id=${CHAT_ID}" \
        --data-urlencode "text=$1" \
        --data-urlencode "disable_web_page_preview=true" 2>/dev/null)" || http=000
    if [ "$http" != "200" ]; then
        log "ERROR Telegram send failed (HTTP $http): $(head -c 200 /tmp/ds-credit-send.$$ 2>/dev/null)"
        rm -f /tmp/ds-credit-send.$$
        return 1
    fi
    rm -f /tmp/ds-credit-send.$$
    log "sent ${CHAT_ID}: $1"
    return 0
}

# --- one-off self test ----------------------------------------------
if [ "$SELF_TEST" = 1 ]; then
    send_telegram "(self-test) DeepSeek credit monitor can reach this chat. Nothing is wrong."
    exit $?
fi

prev_band="ok"
prev_total=""
if [ -f "$STATE" ]; then
    prev_band="$(jq -r '.band // "ok"' "$STATE" 2>/dev/null || echo ok)"
    prev_total="$(jq -r '.total // empty' "$STATE" 2>/dev/null || true)"
fi

# --- read balance ----------------------------------------------------
total=""
rc=0
json="$("$BALANCE" --json 2>/dev/null)" || rc=$?
if [ "$rc" = 0 ] || [ "$rc" = 3 ] || [ "$rc" = 4 ]; then
    total="$(printf '%s' "$json" | jq -r '.total // empty' 2>/dev/null || true)"
fi

if [ -z "$total" ]; then
    band="error"
    detail="$("$BALANCE" 2>&1 | tail -n 1 || true)"
    [ -n "$detail" ] || detail="exit $rc"
else
    band="$(awk -v t="$total" -v w="$WARN" -v c="$CRIT" \
        'BEGIN { print (t < c) ? "crit" : ((t < w) ? "warn" : "ok") }')"
fi

money() { printf 'USD %s' "$1"; }
cur="${total:-unknown}"

msg=""
case "$band" in
    crit)
        msg="⚠️ DeepSeek credit LOW: $(money "$cur") left. Top up now — at zero the agent stops. I will repeat this every 30 min until it is back above $(money "$WARN")."
        ;;
    warn)
        msg="Heads-up: DeepSeek credit is $(money "$cur"), under the $(money "$WARN") line. Below $(money "$CRIT") I start repeating the alert. Nothing to do yet."
        ;;
    ok)
        case "$prev_band" in
            warn | crit | error)
                msg="✅ DeepSeek credit back to $(money "$cur"). Alerting is back to normal (alerts below $(money "$CRIT"))."
                ;;
        esac
        ;;
    error)
        msg="⚠️ DeepSeek balance check failed: ${detail:-unknown error}. Credit state unknown — check it by hand with deepseek-balance.sh."
        ;;
esac

repeat=0
[ "$band" = "crit" ] && repeat=1

action="silent"
if [ -n "$msg" ] && { [ "$repeat" = 1 ] || [ "$band" != "$prev_band" ] || [ "$FORCE" = 1 ]; }; then
    action="send"
fi

log "band=${band} total=${cur} prev=${prev_band} action=${action}"
[ "$action" = "send" ] || exit 0

send_telegram "$msg" || exit 1

if [ "$DRY" = 0 ]; then
    mkdir -p "$(dirname "$STATE")"
    printf '{"band":"%s","total":%s,"checked_at":"%s","notified_at":"%s"}\n' \
        "$band" "$(printf '%s' "$total" | grep -Eq '^[0-9.]+$' && echo "$total" || echo null)" \
        "$(date -Is)" "$(date -Is)" >"$STATE"
fi
exit 0
