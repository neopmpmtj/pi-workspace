#!/usr/bin/env bash
# Stop the local dashboards.
#   orchestrator page and API   8787
#   image describer API         8788
#   web-master page and API     8789
#   image describer page        5173
set -euo pipefail

if ! command -v ss >/dev/null 2>&1; then
  echo "[FAIL] ss is not on PATH" >&2
  exit 1
fi

port_open() {
  ss -H -ltn "sport = :$1" 2>/dev/null | grep -q .
}

stop_port() {
  local port="$1"
  local i
  if ! port_open "$port"; then
    echo "[ok] port ${port} was free"
    return 0
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  else
    echo "[FAIL] port ${port} is in use and fuser is missing" >&2
    return 1
  fi
  for i in $(seq 1 50); do
    if ! port_open "$port"; then
      echo "[ok] stopped ${port}"
      return 0
    fi
    sleep 0.1
  done
  echo "[FAIL] port ${port} still in use" >&2
  return 1
}

stop_port 8787
stop_port 8788
stop_port 8789
stop_port 5173
