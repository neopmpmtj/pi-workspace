#!/usr/bin/env bash
# ============================================================
# deepseek-balance.sh — what credit is left on the DeepSeek account.
#
#   deepseek-balance.sh                 one spoken-friendly line
#   deepseek-balance.sh --json          machine-readable (cron, dashboards)
#   deepseek-balance.sh --min 3         exit 4 when total balance < $3
#   deepseek-balance.sh --quiet         print nothing on success (health check)
#
# Key source: $DEEPSEEK_API_KEY, else DEEPSEEK_API_KEY in the agent .env
# (default ~/.pi/agent/.env; override with DEEPSEEK_ENV_FILE). The key is never
# printed, echoed or passed on the command line.
#
# Exit codes: 0 ok | 1 HTTP/parse failure | 2 no key | 3 account unavailable
#             4 below --min threshold
#
# The endpoint is documented at https://api-docs.deepseek.com/api/get-user-balance
# ============================================================
set -euo pipefail

ENV_FILE="${DEEPSEEK_ENV_FILE:-$HOME/.pi/agent/.env}"
API="${DEEPSEEK_API_URL:-https://api.deepseek.com/user/balance}"

JSON=0
QUIET=0
MIN=""

while [ $# -gt 0 ]; do
    case "$1" in
        --json) JSON=1; shift ;;
        --quiet) QUIET=1; shift ;;
        --min) MIN="${2:-}"; shift 2 ;;
        -h | --help) sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "deepseek-balance.sh: unknown argument: $1" >&2; exit 1 ;;
    esac
done

case "$MIN" in
    "" | *[!0-9.]*)
        [ -n "$MIN" ] && { echo "deepseek-balance.sh: --min needs a number" >&2; exit 1; }
        ;;
esac

# --- key -------------------------------------------------------------
if [ -z "${DEEPSEEK_API_KEY:-}" ] && [ -f "$ENV_FILE" ]; then
    DEEPSEEK_API_KEY="$(
        sed -n 's/^[[:space:]]*DEEPSEEK_API_KEY[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" |
            tail -n 1 | sed 's/[[:space:]]*$//' | sed 's/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/'
    )"
fi
if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
    echo "deepseek-balance.sh: no DEEPSEEK_API_KEY (looked in environment and $ENV_FILE)" >&2
    exit 2
fi

# --- request ---------------------------------------------------------
response="$(curl -sS -m 20 -w '\n%{http_code}' "$API" \
    -H "Authorization: Bearer $DEEPSEEK_API_KEY" -H "Accept: application/json" 2>&1)" || {
    echo "deepseek-balance.sh: request failed: ${response:-no response}" >&2
    exit 1
}
body="${response%$'\n'*}"
status="${response##*$'\n'}"

if [ "$status" != "200" ]; then
    echo "deepseek-balance.sh: HTTP $status from DeepSeek: $(printf '%s' "$body" | head -c 300)" >&2
    exit 1
fi

# --- parse -----------------------------------------------------------
if ! summary="$(printf '%s' "$body" | jq -er '
    [.balance_infos[]?] as $b
    | if ($b | length) == 0 then error("no balance_infos") else . end
    | ($b | map(select(.currency == "USD")) | if length > 0 then .[0] else $b[0] end) as $usd
    | {
        available: (.is_available == true),
        currency: $usd.currency,
        total: ($usd.total_balance | tonumber),
        topped_up: (($usd.topped_up_balance // "0") | tonumber),
        granted: (($usd.granted_balance // "0") | tonumber)
      }
    | "\(.available)\t\(.currency)\t\(.total)\t\(.topped_up)\t\(.granted)"
  ' 2>/dev/null)"; then
    echo "deepseek-balance.sh: unrecognised response: $(printf '%s' "$body" | head -c 300)" >&2
    exit 1
fi

IFS=$'\t' read -r available currency total topped_up granted <<<"$summary"

fmt() { printf '%s %.2f' "$currency" "$1"; }

below=0
if [ -n "$MIN" ]; then
    below="$(awk -v t="$total" -v m="$MIN" 'BEGIN { print (t < m) ? 1 : 0 }')"
fi

if [ "$JSON" = 1 ]; then
    printf '{"available": %s, "currency": "%s", "total": %s, "topped_up": %s, "granted": %s, "below_min": %s}\n' \
        "$([ "$available" = true ] && echo true || echo false)" \
        "$currency" "$total" "$topped_up" "$granted" \
        "$([ "$below" = 1 ] && echo true || echo false)"
else
    [ "$QUIET" = 1 ] || printf 'DeepSeek balance: %s (topped up %s, granted %s) — available: %s\n' \
        "$(fmt "$total")" "$(fmt "$topped_up")" "$(fmt "$granted")" \
        "$([ "$available" = true ] && echo yes || echo NO)"
fi

[ "$available" = true ] || exit 3
[ "$below" = 0 ] || exit 4
exit 0
