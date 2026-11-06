#!/usr/bin/env bash
# =============================================================================
# install-ollama-stack.sh
# One-shot Ollama setup for a local NVIDIA GPU box (tested target: RTX 3060 12GB,
# Linux). Installs Ollama if missing, tunes the service for a 12GB card, pulls a
# document-focused model set, and verifies GPU inference.
#
# Global/shareable by design: no hard-coded user paths, flags for everything.
# See INSTALL.md for requirements and usage.
#
# Exit codes: 0 ok · 1 usage/env error · 2 install failed · 3 model pull failed
#             4 verification failed
# =============================================================================
set -Eeuo pipefail

SCRIPT_NAME="$(basename -- "$0")"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VERSION="1.0.0"
START_TS="$(date +%s)"

# Defaults --------------------------------------------------------------------
DEFAULT_MODELS=(gemma4:12b qwen3.5:9b qwen2.5vl:7b nomic-embed-text)
ALL_EXTRA_MODELS=(phi4 deepseek-r1:14b llama3.1:8b lfm3-audio)
MODELS=("${DEFAULT_MODELS[@]}")
DRY_RUN=0
ASSUME_YES=0
TUNE_SERVICE=1
LOG_FILE=""
MIN_DISK_GB=30

# Colors (disabled when not a TTY) --------------------------------------------
if [[ -t 1 ]]; then
  C_RESET='\033[0m'; C_INFO='\033[1;34m'; C_OK='\033[1;32m'
  C_WARN='\033[1;33m'; C_ERR='\033[1;31m'; C_DIM='\033[2m'
else
  C_RESET=''; C_INFO=''; C_OK=''; C_WARN=''; C_ERR=''; C_DIM=''
fi

log()  { printf '%b[%s]%b %s\n' "$C_DIM" "$(date '+%Y-%m-%d %H:%M:%S')" "$C_RESET" "$*" | tee -a "$LOG_FILE"; }
step() { log ""; log "${C_INFO}==> $*${C_RESET}"; }
ok()   { log "${C_OK}OK${C_RESET}  $*"; }
warn() { log "${C_WARN}WARN${C_RESET} $*"; }
err()  { log "${C_ERR}ERR${C_RESET} $*"; }
die()  { err "$*"; exit "${2:-1}"; }

on_error() {
  local code=$?
  local line=${1:-?}
  err "Command failed at line $line (exit $code). See log: $LOG_FILE"
  exit "$code"
}
trap 'on_error $LINENO' ERR

usage() {
  cat <<EOF
$SCRIPT_NAME v$VERSION — install and tune Ollama for a local NVIDIA GPU

Usage:
  sudo bash $SCRIPT_NAME [options]

Options:
  --models "m1 m2"   Space-separated models to pull (default: ${DEFAULT_MODELS[*]})
  --all              Also pull: ${ALL_EXTRA_MODELS[*]}
  --tts              Also pull lfm3-audio (Ollama-native TTS, 18 languages)
  --no-tune          Skip the systemd service tuning drop-in
  --dry-run          Show what would happen; change nothing
  --yes              Non-interactive (assume yes)
  --log FILE         Write log to FILE (default: ./logs/install-<timestamp>.log)
  -h, --help         Show this help

Examples:
  sudo bash $SCRIPT_NAME
  sudo bash $SCRIPT_NAME --all
  sudo bash $SCRIPT_NAME --models "gemma4:12b qwen3.5:9b"
  bash $SCRIPT_NAME --dry-run
EOF
  exit 0
}

# Parse args ------------------------------------------------------------------
parse_args() {
  while (( $# )); do
    case "$1" in
      --models)
        [[ $# -ge 2 ]] || die "--models needs a quoted list" 1
        read -r -a MODELS <<< "$2"; shift 2 ;;
      --all)
        MODELS+=("${ALL_EXTRA_MODELS[@]}"); shift ;;
      --tts)
        MODELS+=(lfm3-audio); shift ;;
      --no-tune) TUNE_SERVICE=0; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      --yes|-y) ASSUME_YES=1; shift ;;
      --log)
        [[ $# -ge 2 ]] || die "--log needs a path" 1
        LOG_FILE="$2"; shift 2 ;;
      -h|--help) usage ;;
      *) die "Unknown option: $1 (use --help)" 1 ;;
    esac
  done
  (( ${#MODELS[@]} )) || die "No models specified (check --models)" 1
}

init_log() {
  if [[ -z "$LOG_FILE" ]]; then
    local dir="$SCRIPT_DIR/logs"
    [[ -w "$SCRIPT_DIR" ]] || dir="${TMPDIR:-/tmp}"
    mkdir -p "$dir" 2>/dev/null || dir="${TMPDIR:-/tmp}"
    LOG_FILE="$dir/install-ollama-$(date '+%Y%m%d-%H%M%S').log"
  fi
  mkdir -p "$(dirname -- "$LOG_FILE")" 2>/dev/null || true
  : > "$LOG_FILE" || die "Cannot write log file: $LOG_FILE" 1
}

# Helpers ---------------------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

run() {
  if (( DRY_RUN )); then
    log "[dry-run] $*"
    return 0
  fi
  "$@"
}

require_root() {
  if [[ $EUID -eq 0 ]]; then return 0; fi
  if (( DRY_RUN )); then
    warn "Not root — dry-run continues without privileges"
    return 0
  fi
  if have sudo; then
    log "Elevating with sudo..."
    exec sudo --preserve-env=LOG_FILE,DRY_RUN bash "$SCRIPT_DIR/$SCRIPT_NAME" "$@"
  fi
  die "Run as root (or install sudo)" 1
}

# Preflight -------------------------------------------------------------------
preflight() {
  step "Preflight checks"

  local os_name="unknown" os_ver="unknown"
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    os_name="${NAME:-unknown}"; os_ver="${VERSION_ID:-unknown}"
  fi
  log "OS: $os_name $os_ver ($(uname -m))"
  log "Kernel: $(uname -r)"

  if [[ "$(uname -m)" != "x86_64" && "$(uname -m)" != "aarch64" ]]; then
    warn "Unusual architecture $(uname -m); Ollama may not ship a build."
  fi

  local missing=()
  have curl || missing+=("curl")
  have tar  || missing+=("tar")
  have python3 || missing+=("python3")
  if (( ${#missing[@]} )); then
    die "Missing required tools: ${missing[*]}. Install them first (e.g. apt install curl tar python3)." 1
  fi

  if ! have systemctl; then
    warn "systemd not found — service tuning will be skipped; start 'ollama serve' manually."
    TUNE_SERVICE=0
  fi

  # GPU / driver
  if have nvidia-smi; then
    local gpu
    gpu="$(nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>/dev/null | head -n1 || true)"
    if [[ -n "$gpu" ]]; then
      ok "GPU detected: $gpu"
      local vram_mb driver
      vram_mb="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -n1 | tr -d ' ')"
      driver="$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -n1 | tr -d ' ')"
      if [[ "$vram_mb" =~ ^[0-9]+$ ]] && (( vram_mb < 7000 )); then
        warn "Only ${vram_mb} MiB VRAM detected. The default model set targets 12GB; expect offload/slowdown."
      fi
      local drv_major="${driver%%.*}"
      if [[ "$drv_major" =~ ^[0-9]+$ ]] && (( drv_major < 525 )); then
        warn "NVIDIA driver $driver is old; Ollama needs 525+ (550+ recommended). Update before relying on GPU."
      fi
    else
      warn "nvidia-smi present but no GPU reported. Ollama will likely run on CPU."
    fi
  else
    warn "nvidia-smi not found — Ollama will run CPU-only until NVIDIA drivers are installed."
  fi

  # RAM
  local ram_gb=0
  ram_gb="$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo 0)"
  log "System RAM: ${ram_gb} GB"
  (( ram_gb >= 16 )) || warn "16GB+ system RAM recommended for model loading and PDF work."

  # Disk
  local avail_kb avail_gb
  avail_kb="$(df -Pk /usr/share 2>/dev/null | awk 'NR==2 {print $4}' || true)"
  avail_kb="${avail_kb:-0}"
  avail_gb=$(( avail_kb / 1024 / 1024 ))
  log "Free space on /usr/share: ${avail_gb} GB (need ~${MIN_DISK_GB} GB for default models)"
  if (( avail_gb < MIN_DISK_GB )); then
    die "Not enough disk space (${avail_gb} GB free, ${MIN_DISK_GB} GB required)." 1
  fi

  # Port check
  if have ss && ss -ltn 2>/dev/null | grep -q ':11434 '; then
    warn "Port 11434 already in use — an Ollama instance may already be running."
  fi

  ok "Preflight complete"
}

# Install ---------------------------------------------------------------------
install_ollama() {
  step "Installing Ollama"
  if have ollama; then
    local over
    over="$(ollama --version 2>/dev/null | grep -i 'ollama version' | head -n1 || true)"
    ok "Already installed: ${over:-version unknown}"
    return 0
  fi

  local installer="${TMPDIR:-/tmp}/ollama-install-$$.sh"
  log "Downloading official installer from https://ollama.com/install.sh"
  if (( DRY_RUN )); then
    log "[dry-run] curl -fsSL https://ollama.com/install.sh -o $installer"
    log "[dry-run] sh $installer"
    return 0
  fi

  curl -fsSL --retry 3 --connect-timeout 15 https://ollama.com/install.sh -o "$installer" \
    || die "Failed to download Ollama installer" 2
  [[ -s "$installer" ]] || die "Downloaded installer is empty" 2
  grep -q "ollama" "$installer" || die "Downloaded file does not look like the Ollama installer" 2

  log "Running installer (this can take a few minutes)..."
  if ! sh "$installer" 2>&1 | tee -a "$LOG_FILE"; then
    die "Ollama installer failed. Check the log above." 2
  fi
  rm -f "$installer"

  have ollama || die "Ollama binary not found after install" 2
  local over
  over="$(ollama --version 2>/dev/null | grep -i 'ollama version' | head -n1 || true)"
  ok "Ollama installed: ${over:-version unknown}"
}

# Tune service ----------------------------------------------------------------
tune_service() {
  step "Tuning Ollama service for a 12GB GPU"
  if (( ! TUNE_SERVICE )); then
    warn "Skipped (--no-tune or no systemd)"
    return 0
  fi
  if ! systemctl list-unit-files --no-legend ollama.service 2>/dev/null | grep -q '^ollama\.service'; then
    warn "ollama.service not found — skipping tuning. Start 'ollama serve' manually."
    return 0
  fi

  local dropin_dir="/etc/systemd/system/ollama.service.d"
  local dropin="$dropin_dir/10-local-ai.conf"

  if (( DRY_RUN )); then
    log "[dry-run] write $dropin with context/VRAM tuning"
    return 0
  fi

  mkdir -p "$dropin_dir"
  if [[ -f "$dropin" ]]; then
    local backup="${dropin}.bak-$(date '+%Y%m%d-%H%M%S')"
    cp -a "$dropin" "$backup"
    log "Backed up existing drop-in to $backup"
  fi

  cat > "$dropin.tmp" <<'CONF'
# Managed by install-ollama-stack.sh — tuned for a single 12GB consumer GPU.
[Service]
Environment="OLLAMA_CONTEXT_LENGTH=16384"
Environment="OLLAMA_KEEP_ALIVE=30m"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
CONF
  mv "$dropin.tmp" "$dropin"

  systemctl daemon-reload
  systemctl enable ollama >/dev/null 2>&1 || true
  systemctl restart ollama
  ok "Service configured and restarted"
}

wait_for_api() {
  step "Waiting for Ollama API on 127.0.0.1:11434"
  if (( DRY_RUN )); then log "[dry-run] wait for API"; return 0; fi
  local i
  for i in $(seq 1 60); do
    if curl -fsS --max-time 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
      ok "API is up: $(curl -fsS http://127.0.0.1:11434/api/version)"
      return 0
    fi
    sleep 1
  done
  die "Ollama API did not come up within 60s. Check: systemctl status ollama" 2
}

# Models ----------------------------------------------------------------------
model_present() {
  local m="$1"
  ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -Fqx "$m"
}

pull_models() {
  step "Pulling models (${#MODELS[@]})"
  local m t0 t1
  for m in "${MODELS[@]}"; do
    if model_present "$m"; then
      ok "Already present: $m"
      continue
    fi
    log "Pulling $m ..."
    t0="$(date +%s)"
    if (( DRY_RUN )); then
      log "[dry-run] ollama pull $m"
      continue
    fi
    if ! ollama pull "$m" 2>&1 | tee -a "$LOG_FILE"; then
      err "Failed to pull $m"
      exit 3
    fi
    t1="$(date +%s)"
    ok "Pulled $m in $(( t1 - t0 ))s"
  done
}

# Verify ----------------------------------------------------------------------
verify() {
  step "Verifying GPU inference"
  if (( DRY_RUN )); then log "[dry-run] smoke test"; return 0; fi

  local test_model="${MODELS[0]}"
  local t0 t1 resp
  t0="$(date +%s)"
  resp="$(curl -fsS --max-time 300 http://127.0.0.1:11434/api/generate \
    -H 'Content-Type: application/json' \
    -d "{\"model\":\"$test_model\",\"prompt\":\"Reply with exactly: OK\",\"stream\":false,\"options\":{\"num_ctx\":4096}}" 2>>"$LOG_FILE")" \
    || die "Smoke test request failed (model: $test_model)" 4
  t1="$(date +%s)"

  if have python3; then
    python3 - "$resp" "$test_model" "$(( t1 - t0 ))" <<'PY' | tee -a "$LOG_FILE"
import json, sys
raw, model, wall = sys.argv[1], sys.argv[2], int(sys.argv[3])
try:
    d = json.loads(raw)
except Exception as e:
    print(f"WARN  Could not parse API response: {e}")
    sys.exit(0)
text = (d.get("response") or "").strip().replace("\n", " ")
ec = d.get("eval_count") or 0
ed = d.get("eval_duration") or 0
tps = (ec / (ed / 1e9)) if ed else 0
print(f"Model: {model}")
print(f"Reply: {text[:120]}")
print(f"Tokens: {ec} · speed: {tps:.1f} tok/s · wall: {wall}s")
PY
  else
    log "Response received in $(( t1 - t0 ))s (python3 missing, no token stats)"
  fi

  log "Loaded models:"
  ollama ps 2>&1 | tee -a "$LOG_FILE" || true

  # Heuristic: warn if the model is not fully on GPU.
  if ollama ps 2>/dev/null | awk 'NR>1 {print $4}' | grep -qv '100% GPU'; then
    warn "One or more models are not 100% GPU. Check VRAM pressure / reduce context."
  fi
}

# Summary ---------------------------------------------------------------------
summary() {
  local elapsed=$(( $(date +%s) - START_TS ))
  step "Done in ${elapsed}s"
  log "Log file: $LOG_FILE"
  log ""
  log "Try it:"
  log "  ollama run ${MODELS[0]}"
  log "  ollama ps"
  log "  curl http://127.0.0.1:11434/api/tags"
  log ""
  log "Installed models:"
  if (( DRY_RUN )); then
    printf '  %s\n' "${MODELS[@]}" | tee -a "$LOG_FILE"
  else
    ollama list 2>&1 | tee -a "$LOG_FILE" || true
  fi
  log ""
  log "Next: use summarize-doc.py for PDFs/text (see INSTALL.md)."
}

main() {
  parse_args "$@"
  init_log
  log "$SCRIPT_NAME v$VERSION starting"
  log "Log: $LOG_FILE"
  require_root "$@"
  preflight
  install_ollama
  tune_service
  wait_for_api
  pull_models
  verify
  summary
}

main "$@"
