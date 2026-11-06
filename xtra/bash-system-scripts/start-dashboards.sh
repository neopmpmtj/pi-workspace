#!/usr/bin/env bash
# Start the local dashboards.
#   orchestrator page and API   http://127.0.0.1:8787
#   image describer API         http://127.0.0.1:8788
#   web-master page and API     http://127.0.0.1:8789
#   image describer page        http://127.0.0.1:5173
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
log_dir="$root/.dashboard-logs"
orch="$root/agent/cos-orchestrator-agent"
describer="$root/agent-image-describer/image-describer"
describer_ui="$describer/dashboard"
web_master="$root/agent-web-master/web-master"

mkdir -p "$log_dir"

if ! command -v npm >/dev/null 2>&1; then
  echo "[FAIL] npm is not on PATH" >&2
  exit 1
fi
if ! command -v ss >/dev/null 2>&1; then
  echo "[FAIL] ss is not on PATH" >&2
  exit 1
fi

port_open() {
  ss -H -ltn "sport = :$1" 2>/dev/null | grep -q .
}

busy=0
for port in 8787 8788 8789 5173; do
  if port_open "$port"; then
    echo "[FAIL] port ${port} is already in use" >&2
    busy=1
  fi
done
if [[ "$busy" -ne 0 ]]; then
  echo "[FAIL] run scripts/stop-dashboards.sh first" >&2
  exit 1
fi

start_one() {
  local name="$1"
  local dir="$2"
  shift 2
  local log="$log_dir/${name}.log"
  : >"$log"
  local pid
  pid="$(
    cd "$dir" || exit 1
    nohup "$@" >>"$log" 2>&1 &
    echo $!
  )"
  echo "$pid" >"$log_dir/${name}.pid"
  echo "$pid"
}

wait_up() {
  local name="$1"
  local port="$2"
  local pid="$3"
  local log="$log_dir/${name}.log"
  local i
  for i in $(seq 1 80); do
    if port_open "$port"; then
      echo "[ok] ${name}  http://127.0.0.1:${port}"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[FAIL] ${name} exited. Log: ${log}" >&2
      tail -n 30 "$log" >&2 || true
      return 1
    fi
    sleep 0.25
  done
  echo "[FAIL] ${name} did not listen on ${port}. Log: ${log}" >&2
  tail -n 30 "$log" >&2 || true
  return 1
}

orch_pid="$(start_one orchestrator "$orch" env DASHBOARD_PORT=8787 npm run dashboard)"
api_pid="$(start_one describer-api "$describer" env DASHBOARD_PORT=8788 npm run dashboard)"
web_pid="$(start_one web-master "$web_master" env DASHBOARD_PORT=8789 npm run dashboard)"
ui_pid="$(start_one describer-ui "$describer_ui" npm run dev -- --host 127.0.0.1 --port 5173 --strictPort)"

failed=0
wait_up orchestrator 8787 "$orch_pid" || failed=1
wait_up describer-api 8788 "$api_pid" || failed=1
wait_up web-master 8789 "$web_pid" || failed=1
wait_up describer-ui 5173 "$ui_pid" || failed=1

echo "logs: ${log_dir}"
exit "$failed"
