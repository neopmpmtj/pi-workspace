#!/usr/bin/env bash
# ============================================================
# serve-site.sh — start the project site (~/.pi/control) on :8786.
#
#   serve-site.sh            run in the foreground (what pi-site.service runs)
#   PI_SITE_PORT=8799 serve-site.sh
#
# Why a wrapper: the site needs node, and a systemd user unit or an ssh shell
# has no nvm function. This resolves the same node the launcher uses, then
# execs the server, so the unit file stays one line and a by-hand start behaves
# exactly like the unit.
#
# Port and bind address come from the server itself: DASHBOARD-style env is not
# used here — control/server.ts reads PROJECT_PORT (8786, 127.0.0.1).
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # ~/.pi

NODE="${PI_AGENT_NODE:-}"
if [ -z "$NODE" ]; then
    NODE="$(command -v node 2>/dev/null || true)"
fi
if [ -z "$NODE" ]; then
    NODE="$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -n1 || true)"
fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
    echo "serve-site.sh: node not found; set PI_AGENT_NODE" >&2
    exit 1
fi

cd "$ROOT/control"
exec "$NODE" --experimental-strip-types server.ts
