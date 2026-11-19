#!/usr/bin/env bash
# backup-host-state.sh — archive the per-host state that git no longer protects.
#
# Everything this repo keeps in the ".gitignore / PER-HOST STATE" block lives on
# exactly one disk. This script tars that set into ~/pi-host-backups and keeps the
# last N archives, so an accidental rm, a bad restore or a dead SSD is survivable.
#
#   bash ~/.pi/scripts/backup-host-state.sh            # write one archive
#   bash ~/.pi/scripts/backup-host-state.sh --list     # show what would be saved
#   PI_BACKUP_KEEP=30 ... (retention, default 14)
#   PI_BACKUP_DIR=/path ... (target, default ~/pi-host-backups)
#   PI_BACKUP_REMOTE=pistore@192.168.1.60:/path (optional rsync copy)
#
# The archive embeds .env / auth.json / bot tokens: it is written mode 600.

set -uo pipefail

. "$HOME/.pi/scripts/env.sh" 2>/dev/null || true

HOST=$(hostname -s 2>/dev/null || echo host)
DEST="${PI_BACKUP_DIR:-$HOME/pi-host-backups}"
KEEP="${PI_BACKUP_KEEP:-14}"
STAMP=$(date +%F)
ARCHIVE="$DEST/pi-host-$HOST-$STAMP.tar.gz"

# Per-host state, relative to $HOME. Keep this list aligned with the
# "PER-HOST STATE" section of ~/.pi/.gitignore.
CANDIDATES=(
	".pi/agent/.env"
	".pi/agent/auth.json"
	".pi/agent/telegram.json"
	".pi/agent/settings.json"
	".pi/agent/trust.json"
	".pi/agent/model-rates.json"
	".pi/agent/models-store.json"
	".pi/agent/default-model.json"
	".pi/agent/cron/jobs.json"
	".pi/config.json"
	".pi/input-phrase-config.json"
	".pi/prompt-build-config.json"
	".pi/cron/jobs.json"
	".pi/decision-nodes/reminder/reminders.jsonl"
	".pi/agent/logs/ledger.sqlite"
	".pi/agent-web-master/web-master/settings.json"
	".pi/agent-web-master/web-master/trust.json"
	".pi/agent-web-master/web-master/default-web-master-model.json"
	".pi/agent-tasks-agent/tasks-agent/settings.json"
	".pi/agent-tasks-agent/tasks-agent/trust.json"
	".pi/agent-gog-workspace-agents/sm-google-workspace/sm-google-workspace/settings.json"
	".pi/agent-gog-workspace-agents/sm-google-workspace/sm-google-workspace/trust.json"
	".pi/agent-image-describer/image-describer/settings.json"
	".pi/agent-template-new-agent/template-new-agent/settings.json"
	".pi/agent-template-new-agent/template-new-agent/trust.json"
)

# Add any trust.json/settings.json the list above has not learned about yet, skipping
# dead copies and separate checkouts that happen to live under ~/.pi.
PRUNE=("*/.git/*" "*/z.old/*" "*/keep-agent-copy/*" "*/agent#copy/*" "*/explore-discover-pi/*")
PRUNE_ARGS=()
for pat in "${PRUNE[@]}"; do PRUNE_ARGS+=(-not -path "$pat"); done

while IFS= read -r extra; do
	rel="${extra#"$HOME"/}"
	case " ${CANDIDATES[*]} " in
		*" $rel "*) ;;
		*) CANDIDATES+=("$rel") ;;
	esac
done < <(find "$HOME/.pi" -maxdepth 4 \( -name trust.json -o -name settings.json -o -name reminders.jsonl \) \
	-not -path "*/node_modules/*" "${PRUNE_ARGS[@]}" 2>/dev/null)

PRESENT=()
for rel in "${CANDIDATES[@]}"; do
	[ -f "$HOME/$rel" ] && PRESENT+=("$rel")
done

if [ "${1:-}" = "--list" ]; then
	printf '%s\n' "${PRESENT[@]}"
	echo "(${#PRESENT[@]} files, host $HOST)"
	exit 0
fi

if [ "${#PRESENT[@]}" -eq 0 ]; then
	echo "nothing to back up" >&2
	exit 1
fi

mkdir -p "$DEST" || { echo "cannot create $DEST" >&2; exit 1; }
umask 077
if ! (cd "$HOME" && tar -czf "$ARCHIVE" "${PRESENT[@]}" 2>/dev/null); then
	echo "[FAIL] tar failed" >&2
	exit 1
fi
chmod 600 "$ARCHIVE" 2>/dev/null || true

# Retention: keep the newest $KEEP archives for this host.
ls -1t "$DEST"/pi-host-"$HOST"-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
	rm -f "$old" && echo "pruned $(basename "$old")"
done

echo "wrote $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1), ${#PRESENT[@]} files)"

# Optional off-host copy (e.g. the LAN file server). Best effort, never fatal.
if [ -n "${PI_BACKUP_REMOTE:-}" ]; then
	if rsync -a --quiet "$ARCHIVE" "$PI_BACKUP_REMOTE" 2>/dev/null; then
		echo "copied to $PI_BACKUP_REMOTE"
	else
		echo "[WARN] rsync to $PI_BACKUP_REMOTE failed" >&2
	fi
fi
exit 0
