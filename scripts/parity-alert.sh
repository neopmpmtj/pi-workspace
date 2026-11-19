#!/usr/bin/env bash
# parity-alert.sh — nightly drift check that speaks up on Telegram.
#
# Runs on the host that owns the Telegram bridge (the VPS). Compares its own
# fingerprint with the last one the laptop published (scripts/publish-fingerprint.sh),
# and reports:
#   - any field that differs between the two installs,
#   - this host being behind origin,
#   - the laptop fingerprint going stale (informational, logged only).
#
# Silent when everything matches: a quiet bot is a healthy bot.

set -uo pipefail

. "$HOME/.pi/scripts/env.sh" 2>/dev/null || true

REPO="${PI_REPO:-$HOME/.pi}"
STATE="$REPO/agent/tmp/parity"
LOG="$REPO/logs/parity-alert.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG" 2>/dev/null; }

# HEAD/BEHIND describe git timing, not install shape: a commit pushed after the peer last
# published would otherwise alert on every push. Install parity is what this checks.
FIELD_BLACKLIST="HOST AT BEHIND HEAD"
is_blacklisted() { case " $FIELD_BLACKLIST " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

self_fp=$(bash "$HOME/.pi/scripts/fingerprint.sh" 2>/dev/null)
[ -z "$self_fp" ] && { log "cannot fingerprint self"; exit 1; }

# Peer fingerprint: live over ssh when the peer answers, otherwise the last one it
# published (agent/tmp/parity/). The live path needs sshd on the laptop, which exists
# since 2026-11-19 bound to its Tailscale address only.
PEER_SSH="${PI_PEER_HOST:-laptop}"
peer_fp=""
peer_file=""
peer_source="none"

TMPFP=$(mktemp) || exit 1
trap 'rm -f "$TMPFP"' EXIT

if command -v ssh >/dev/null 2>&1 && timeout 25 ssh -o BatchMode=yes -o ConnectTimeout=8 "$PEER_SSH" \
	'bash ~/.pi/scripts/fingerprint.sh' > "$TMPFP" 2>/dev/null; then
	grep -q '^HOST=' "$TMPFP" && { peer_fp=$(cat "$TMPFP"); peer_source="live via $PEER_SSH"; }
fi

if [ -z "$peer_fp" ]; then
	peer_file=""
	for cand in "$STATE"/*.fingerprint; do
		[ -f "$cand" ] && peer_file="$cand"
	done
	if [ -n "${peer_file:-}" ]; then
		peer_fp=$(cat "$peer_file")
		peer_source="published $(basename "$peer_file")"
	fi
fi

[ -z "$peer_fp" ] && { log "peer unreachable and no published fingerprint in $STATE — nothing to compare"; exit 0; }

peer_host=$(printf '%s\n' "$peer_fp" | awk -F= '/^HOST=/{print $2}')

declare -A self_vals peer_vals
while IFS='=' read -r k v; do [[ "${k:-}" =~ ^[A-Z_]+$ ]] && self_vals["$k"]="$v"; done <<< "$self_fp"
while IFS='=' read -r k v; do [[ "${k:-}" =~ ^[A-Z_]+$ ]] && peer_vals["$k"]="$v"; done <<< "$peer_fp"

drift=()
for k in "${!self_vals[@]}"; do
	is_blacklisted "$k" && continue
	pv="${peer_vals[$k]:-MISSING}"
	sv="${self_vals[$k]}"
	[ "$sv" != "$pv" ] && drift+=("$k: vps=$sv  peer=$pv")
done

behind="${self_vals[BEHIND]:-0}"
self_host="${self_vals[HOST]:-unknown}"

# Peer freshness: a stale publish means the laptop has not run a session recently.
peer_at=$(awk -F= '/^AT=/{print $2}' "$peer_file")
peer_age_h=0
if [ -n "${peer_at:-}" ]; then
	peer_epoch=$(date -u -d "$peer_at" +%s 2>/dev/null || echo 0)
	[ "$peer_epoch" -gt 0 ] && peer_age_h=$(( ( $(date -u +%s) - peer_epoch ) / 3600 ))
fi

lines=()
[ "${#drift[@]}" -gt 0 ] && lines+=("🔀 <b>Host parity drift</b>" "" ) && for d in "${drift[@]}"; do lines+=("• <code>${d//</&lt;}</code>"); done
case "${behind:-0}" in ''|*[!0-9]*) behind=0 ;; esac
[ "${behind:-0}" -gt 0 ] && lines+=("⏬ $self_host is $behind commit(s) behind origin")

if [ "${#lines[@]}" -eq 0 ]; then
	log "ok (peer=$peer_host, source=$peer_source, peer_age=${peer_age_h}h)"
	exit 0
fi

[ "$peer_age_h" -gt 168 ] && lines+=("" "ℹ️ peer fingerprint is ${peer_age_h}h old — run a session on $peer_host")

msg=$(printf '%s\n' "${lines[@]}")

# --- deliver -----------------------------------------------------------------
TOKEN=""
if [ -f "$REPO/agent/.env" ]; then
	TOKEN=$(grep -E '^\s*(export\s+)?TELEGRAM_BOT_TOKEN=' "$REPO/agent/.env" | tail -1 | sed -E 's/^[^=]*=//; s/^"//; s/"$//')
fi
CHAT=$(python3 -c "import json;d=json.load(open('$REPO/agent/telegram.json'));print((d.get('profiles',{}).get('default',{}) or {}).get('allowedUserId',''))" 2>/dev/null)

if [ -n "$TOKEN" ] && [ -n "$CHAT" ]; then
	if curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST \
		"https://api.telegram.org/bot$TOKEN/sendMessage" \
		-d "chat_id=$CHAT" --data-urlencode "text=$msg" -d "parse_mode=HTML" | grep -q '^200$'; then
		log "alert sent: ${#drift[@]} drift field(s), behind=$behind"
		exit 0
	fi
	log "telegram send failed"
else
	log "no token/chat configured — alert not sent"
fi

printf '%s\n' "$msg"
exit 1
