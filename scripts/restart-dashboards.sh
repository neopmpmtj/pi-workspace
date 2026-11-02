#!/usr/bin/env bash
# Stop and start the local dashboards so a code change is loaded.
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$dir/stop-dashboards.sh"
"$dir/start-dashboards.sh"
