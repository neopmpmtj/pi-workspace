#!/usr/bin/env bash
# check-registers.sh — a file nobody can find is a bug.
#
# Fails when a script under ~/.pi/scripts or a runbook under agent/docs/runbooks exists
# without a row in its register (docs/SCRIPTS.md, agent/docs/runbooks/INDEX.md).
# Cheap, offline, no model tokens. Run it after adding files, or via sync-hosts.sh.

set -uo pipefail

. "$HOME/.pi/scripts/env.sh" 2>/dev/null || true
REPO="${PI_REPO:-$HOME/.pi}"
cd "$REPO" || exit 1

SCRIPTS_REG="docs/SCRIPTS.md"
RUNBOOKS_REG="agent/docs/runbooks/INDEX.md"
missing=0

[ -f "$SCRIPTS_REG" ] || { echo "[FAIL] missing $SCRIPTS_REG"; exit 1; }
[ -f "$RUNBOOKS_REG" ] || { echo "[FAIL] missing $RUNBOOKS_REG"; exit 1; }

# 1. every top-level script file and the systemd unit copies
while IFS= read -r f; do
	base=$(basename "$f")
	grep -qF "$base" "$SCRIPTS_REG" || { echo "MISSING from $SCRIPTS_REG: $f"; missing=1; }
done < <(find scripts -maxdepth 1 -type f \( -name '*.sh' -o -name '*.ts' -o -name '*.py' -o -name '*.txt' \) | sort)

while IFS= read -r f; do
	base=$(basename "$f")
	grep -qF "$base" "$SCRIPTS_REG" || { echo "MISSING from $SCRIPTS_REG: $f"; missing=1; }
done < <(find scripts/systemd -maxdepth 1 -type f | sort)

# 2. every runbook except the index itself
while IFS= read -r f; do
	base=$(basename "$f")
	[ "$base" = "INDEX.md" ] && continue
	grep -qF "$base" "$RUNBOOKS_REG" || { echo "MISSING from $RUNBOOKS_REG: $f"; missing=1; }
done < <(find agent/docs/runbooks -maxdepth 1 -name '*.md' | sort)

# 3. loose instruction docs at the repo root docs/
if [ -d docs ]; then
	while IFS= read -r f; do
		base=$(basename "$f")
		[ "$base" = "SCRIPTS.md" ] && continue
		if ! grep -qF "$base" "$SCRIPTS_REG" "$RUNBOOKS_REG" docs/pi-state-summary.md agent/AGENTS.md 2>/dev/null; then
			echo "WARN not referenced anywhere: $f"
		fi
	done < <(find docs -maxdepth 1 -name '*.md' | sort)
fi

if [ "$missing" -eq 0 ]; then
	echo "registers: OK ($(find scripts -maxdepth 1 -type f | wc -l | tr -d ' ') script entries, $(find agent/docs/runbooks -maxdepth 1 -name '*.md' | wc -l | tr -d ' ') runbooks)"
	exit 0
fi
echo "registers: add the rows above (scr/pts) to the matching register"
exit 1
