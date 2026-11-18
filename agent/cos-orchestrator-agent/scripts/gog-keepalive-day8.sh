#!/usr/bin/env bash
# gog-keepalive-day8 — the 2026-11-26 verdict on the gog OAuth token, then switch off the probe.
#
# WHY: the token was re-consented on 2026-11-18T11:50:37Z with the OAuth app published to
# production. Nothing before day 8 can prove the fix, because the previous testing-mode token
# also worked for its first week and then died. This job runs once on 2026-11-26, reports the
# verdict to Telegram, and — only if the verdict is OK — disables the daily
# gog-token-keepalive timer, as the owner asked. A failed verdict leaves the timer armed.
#
# Contract with gog-keepalive-day8.service / .timer (one shot, 2026-11-26 08:30 Europe/Lisbon):
#   exit 0  verdict sent (OK or FAIL) and the timer state matches the verdict
#   exit 2  misconfigured (no gog binary, no bot token, no chat id)
#   --dry-run  run the probe, print both the message and the intended timer action
#
# Idempotent: safe to replay after a missed boot (Persistent=true). Replaying a second time on a
# later date still reports the same token age and leaves the timer disabled.

set -uo pipefail
export PATH="$HOME/.pi/agent/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

DRY_RUN=0
case "${1:-}" in
  --dry-run) DRY_RUN=1 ;;
  -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
  "") ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac

CHECK_ID="gog-keepalive-day8"
AGENT_HOME="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent/cos-orchestrator-agent}"
LOG_DIR="${GOG_KEEPALIVE_LOG_DIR:-$HOME/.pi/agent/logs}"
LOG="$LOG_DIR/${CHECK_ID}.log"
PROBE="$AGENT_HOME/scripts/gog-token-keepalive.sh"
KEEPALIVE_TIMER="gog-token-keepalive.timer"
DAY8_TIMER="gog-keepalive-day8.timer"
HOST="$(uname -n)"
TOKEN_CREATED="2026-11-18T11:50:37Z"
mkdir -p "$LOG_DIR" || exit 2

say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"; printf '%s\n' "$*"; }

# Read env files as DATA, never as shell: values contain `$`, `!` and backticks, and sourcing
# them under `set -u` has broken this tree before. Already-exported values win.
load_env() { # load_env <file>
  local file="$1" line key value
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in *=*) ;; *) continue ;; esac
    key="${line%%=*}"
    key="${key#export }"
    key="${key//[[:space:]]/}"
    case "$key" in ''|*[!A-Za-z0-9_]*) continue ;; esac
    value="${line#*=}"
    case "$value" in \"*\") value="${value:1:${#value}-2}" ;; \'*\') value="${value:1:${#value}-2}" ;; esac
    [ -n "${!key:-}" ] && continue
    printf -v "$key" '%s' "$value"
  done <"$file"
}
load_env "$HOME/.pi/agent/cos-orchestrator-agent/.env"
load_env "$HOME/.pi/agent/.env"

send_telegram() { # send_telegram <text>
  local text="$1" token="${TELEGRAM_BOT_TOKEN:-}" chat
  if [ "$DRY_RUN" = "1" ]; then
    printf -- '--- DRY-RUN telegram ---\n%s\n--- end ---\n' "$text"
    return 0
  fi
  if [ -z "$token" ]; then say "no TELEGRAM_BOT_TOKEN; verdict kept to the log"; return 2; fi
  chat="$(grep -oE '"allowedUserId"[[:space:]]*:[[:space:]]*[0-9]+' "$AGENT_HOME/telegram.json" 2>/dev/null \
    | grep -oE '[0-9]+$' | head -1)"
  if [ -z "$chat" ]; then say "no allowedUserId; verdict kept to the log"; return 2; fi
  if curl -sS --max-time 20 -X POST "https://api.telegram.org/bot${token}/sendMessage" \
       -d "chat_id=${chat}" -d "disable_web_page_preview=true" \
       --data-urlencode "text=${text}" >/dev/null 2>&1; then
    say "verdict sent to $chat"
  else
    say "telegram send failed; verdict kept to the log"
    return 2
  fi
}

# ---- the probe ---------------------------------------------------------------
[ -x "$PROBE" ] || { say "missing probe script $PROBE"; exit 2; }
"$PROBE" >/dev/null 2>&1
probe_exit=$?
last="$(tail -1 "$LOG_DIR/gog-token-keepalive.log" 2>/dev/null)"
case "$last" in
  *" OK: "*) verdict="OK" ;;
  *" FAIL: "*) verdict="FAIL" ;;
  *) verdict="UNKNOWN" ;;
esac
streak="$(cat "$LOG_DIR/gog-token-keepalive.streak" 2>/dev/null || echo '?')"
age_days=$(( ( $(date -u +%s) - $(date -u -d "$TOKEN_CREATED" +%s) ) / 86400 ))

# ---- the timer action -------------------------------------------------------
# Only an OK verdict may switch the daily probe off; a failure keeps the tripwire armed.
if [ "$verdict" = "OK" ]; then
  timer_action="disabling ${KEEPALIVE_TIMER}"
  if [ "$DRY_RUN" = "1" ]; then
    say "DRY-RUN: would run systemctl --user disable --now ${KEEPALIVE_TIMER}"
    timer_state="would be disabled"
  else
    systemctl --user disable --now "$KEEPALIVE_TIMER" >/dev/null 2>&1
    if systemctl --user is-enabled --quiet "$KEEPALIVE_TIMER" 2>/dev/null; then
      timer_state="FAILED to disable"
    else
      timer_state="disabled"
    fi
    say "${timer_action} -> ${timer_state}"
  fi
else
  timer_action="left ${KEEPALIVE_TIMER} armed"
  timer_state="left running (probe not OK)"
  say "verdict ${verdict}; ${timer_action}"
fi

# ---- the report -------------------------------------------------------------
message="🔐 gog token — day 8 (${HOST})
Verdict: ${verdict} (probe exit ${probe_exit}, streak ${streak})
Token issued: ${TOKEN_CREATED} → ${age_days} days old
Last probe line: ${last}
Keepalive timer: ${timer_state}"

send_telegram "$message"
send_exit=$?

# This job is one shot; retire its own timer so it cannot repeat next year.
if [ "$DRY_RUN" != "1" ]; then
  systemctl --user disable --now "$DAY8_TIMER" >/dev/null 2>&1
fi

say "done: verdict=${verdict} timer=${timer_state} send_exit=${send_exit}"
[ "$send_exit" -eq 0 ] || exit 2
exit 0
