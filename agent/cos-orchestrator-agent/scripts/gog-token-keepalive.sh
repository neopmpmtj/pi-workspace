#!/usr/bin/env bash
# gog-token-keepalive — daily read-only probe that the `gog` OAuth token still works.
#
# An expired or revoked Google token fails silently until a human happens to need
# gog. This runs one authenticated read, records it, and messages the owner only
# when the probe fails.
#
# Contract with gog-token-keepalive.service / .timer (08:00 Europe/Lisbon,
# Persistent=true, so a skipped run catches up after boot):
#   exit 0  healthy
#   exit 1  the probe ran and failed (token, account, network, API)
#   exit 2  misconfigured: no gog binary, or the credentials it needs are absent
#   --dry-run  probe anyway, print the alarm instead of sending it
#
# Absolute paths on purpose: a systemd user unit gets a minimal PATH, and on this
# host the gog binary lives in ~/.pi/agent/bin, which is not on it.

set -uo pipefail
export PATH="$HOME/.pi/agent/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"

DRY_RUN=0
case "${1:-}" in
  --dry-run) DRY_RUN=1 ;;
  -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
  "") ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac

CHECK_ID="gog-token-keepalive"
TIMEOUT=60
AGENT_HOME="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent/cos-orchestrator-agent}"
LOG_DIR="${GOG_KEEPALIVE_LOG_DIR:-$HOME/.pi/agent/logs}"
LOG="$LOG_DIR/${CHECK_ID}.log"
LEDGER="$LOG_DIR/${CHECK_ID}.jsonl"
STREAK_FILE="$LOG_DIR/${CHECK_ID}.streak"
HOST="$(uname -n)"

mkdir -p "$LOG_DIR" || exit 2
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# ---- credentials -------------------------------------------------------------
# Read the env files as DATA, never as shell. They hold secrets containing `$` and
# `!` (a Postgres SCRAM hash starts with `$4$`), and sourcing such a line under
# `set -u` aborts the script — which is how this file broke the first time. Values
# already exported by the caller win, so a unit or a test can override them.
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
    export "$key"
  done <"$file"
}

# Two files, different owners: on this host the legacy default-home env carries the
# gog values, while the agent home carries the bot token used for the alarm.
load_env "$HOME/.pi/agent/.env"
load_env "$AGENT_HOME/.env"

# ---- gog binary --------------------------------------------------------------
GOG="${GOG_BIN:-}"
if [ -z "$GOG" ]; then
  for candidate in "$HOME/.pi/agent/bin/gog" "$HOME/.local/bin/gog" \
                   /home/linuxbrew/.linuxbrew/bin/gog "$(command -v gog 2>/dev/null)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then GOG="$candidate"; break; fi
  done
fi

# ---- recording ---------------------------------------------------------------
record() { # record <level> <reason> <durationMs> <exitCode>
  local level="$1" reason="$2" ms="$3" code="$4" ts
  ts="$(stamp)"
  printf '%s %s: %s (probe %sms)\n' "$ts" "$level" "$reason" "$ms" >>"$LOG"
  /usr/bin/python3 - "$LEDGER" "$ts" "$level" "$reason" "$ms" "$code" "$HOST" "$GOG" <<'PY' 2>/dev/null || true
import json, sys
path, ts, level, reason, ms, code, host, gog = sys.argv[1:9]
record = {"check": "gog-token-keepalive", "at": ts, "level": level,
          "reason": reason, "durationMs": int(ms or 0),
          "exitCode": int(code or 0), "host": host, "gog": gog}
with open(path, "a", encoding="utf-8") as handle:
    handle.write(json.dumps(record, separators=(",", ":")) + "\n")
PY
}

alarm() { # alarm <text> — failure only; nothing is sent on a healthy run
  local text="$1" token="${TELEGRAM_BOT_TOKEN:-}" chat
  if [ "$DRY_RUN" = "1" ]; then
    echo "DRY-RUN alert: $text"
    return 0
  fi
  if [ -z "$token" ]; then
    echo "no TELEGRAM_BOT_TOKEN available; alarm kept to the journal" >&2
    return 0
  fi
  chat="$(grep -oE '"allowedUserId"[[:space:]]*:[[:space:]]*[0-9]+' "$AGENT_HOME/telegram.json" 2>/dev/null \
    | grep -oE '[0-9]+$' | head -1)"
  if [ -z "$chat" ]; then
    echo "no allowedUserId in $AGENT_HOME/telegram.json; alarm kept to the journal" >&2
    return 0
  fi
  if curl -sS --max-time 20 -X POST "https://api.telegram.org/bot${token}/sendMessage" \
       -d "chat_id=${chat}" -d "disable_web_page_preview=true" \
       --data-urlencode "text=${text}" >/dev/null 2>&1; then
    echo "alarm sent to ${chat}"
  else
    echo "alarm send failed; kept to the journal" >&2
  fi
}

fail() { # fail <reason> <exitCode> <durationMs>
  local reason="$1" code="$2" ms="$3" streak
  streak=$(( $(cat "$STREAK_FILE" 2>/dev/null || echo 0) + 1 ))
  echo "$streak" >"$STREAK_FILE"
  record "FAIL" "$reason" "$ms" "$code"
  alarm "⚠️ ${CHECK_ID} on ${HOST}: ${reason} (probe ${ms}ms, streak ${streak})"
  echo "FAIL: $reason" >&2
  exit "$code"
}

# ---- preconditions -----------------------------------------------------------
if [ -z "$GOG" ] || [ ! -x "$GOG" ]; then
  fail "gog binary is missing or not executable (looked in ~/.pi/agent/bin, ~/.local/bin, homebrew)" 2 0
fi
if [ -z "${GOG_ACCOUNT:-}" ]; then
  fail "GOG_ACCOUNT is not set, and \`gog drive ls\` needs it on this host" 2 0
fi
if [ -z "${GOG_KEYRING_PASSWORD:-}" ] && [ "${GOG_KEYRING_BACKEND:-file}" = "file" ]; then
  fail "GOG_KEYRING_PASSWORD is not set, so the file keyring cannot be unlocked non-interactively" 2 0
fi

# ---- probe -------------------------------------------------------------------
# `gog drive ls` is the cheapest call that proves the token refreshes; capturing its
# output (instead of piping to head) keeps $? pointing at gog rather than at SIGPIPE.
start_ms="$(date +%s%3N)"
out="$(timeout "$TIMEOUT" "$GOG" drive ls 2>&1)"
code=$?
end_ms="$(date +%s%3N)"
ms=$(( end_ms - start_ms ))

if [ "$code" -ne 0 ]; then
  reason="$(printf '%s\n' "$out" | grep -vE '^[[:space:]]*$' | tail -1 | cut -c1-200)"
  [ -n "$reason" ] || reason="gog exited ${code} with no output"
  fail "$reason" 1 "$ms"
fi

echo 0 >"$STREAK_FILE"
record "OK" "auth healthy" "$ms" 0
echo "OK: auth healthy (probe ${ms}ms)"
