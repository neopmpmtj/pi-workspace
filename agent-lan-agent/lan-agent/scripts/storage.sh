#!/usr/bin/env bash
# storage.sh — the only way lan-agent touches the file server.
#
# Reads ../config/storage.json for host/user/port/key/remoteRoot, then drives
# ssh + rsync. Nothing here needs sudo, on either side. Every failure prints a
# line starting with [FAIL] and exits non-zero, so a caller can check $?.
#
#   scripts/storage.sh config                    effective settings + which fields are unset
#   scripts/storage.sh use --host 192.168.1.50   change settings in place (IP/target moved)
#   scripts/storage.sh check                     config, TCP reachability, key auth, write test, df
#   scripts/storage.sh df                        free space on the server
#   scripts/storage.sh ls [subdir]               list a folder under remoteRoot
#   scripts/storage.sh put <local...> [--to s]   upload files (rsync, resumable)
#   scripts/storage.sh get <remote-sub> <local>  download a folder or file
#   scripts/storage.sh sync <local-dir> <sub>    mirror a local folder to the server
#   scripts/storage.sh rm <remote-sub...>        delete paths under remoteRoot
#   scripts/storage.sh ssh <command...>          run one command on the server
#   scripts/storage.sh shell                     interactive shell on the server
#
# --dry-run is accepted by put/get/sync/rm.

set -uo pipefail

HOME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${STORAGE_CONFIG:-$HOME_DIR/config/storage.json}"

HOST=""; USER_NAME=""; PORT="22"; IDENTITY=""; REMOTE_ROOT=""; DEFAULT_SUBDIR=""
DRY_RUN=""

die() { local code="$1"; shift; printf '[FAIL] %s\n' "$*" >&2; exit "$code"; }
say() { printf '%s\n' "$*"; }

load_config() {
  [ -f "$CONFIG" ] || die 2 "config missing: $CONFIG (see docs/SETUP.md, or write one with: scripts/storage.sh use --host <ip>)"
  local dump
  dump="$(node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { console.error("[FAIL] cannot parse " + file + ": " + error.message); process.exit(2); }
    for (const key of ["host", "user", "port", "identityFile", "remoteRoot", "defaultSubdir"]) {
      const value = data[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") console.log(key + "\t" + String(value).trim());
    }
  ' "$CONFIG")" || die 2 "cannot read $CONFIG"
  local key value
  while IFS=$'\t' read -r key value; do
    case "$key" in
      host) HOST="$value" ;;
      user) USER_NAME="$value" ;;
      port) PORT="$value" ;;
      identityFile) IDENTITY="$value" ;;
      remoteRoot) REMOTE_ROOT="$value" ;;
      defaultSubdir) DEFAULT_SUBDIR="$value" ;;
    esac
  done <<< "$dump"
  case "$IDENTITY" in "~/"*) IDENTITY="$HOME/${IDENTITY#\~/}" ;; esac
}

missing() { # prints the names of unset/placeholder fields
  local out=()
  [[ -z "$HOST" || "$HOST" == *REPLACE* || "$HOST" == \<* ]] && out+=("host")
  [[ -z "$USER_NAME" || "$USER_NAME" == *REPLACE* ]] && out+=("user")
  [[ -z "$REMOTE_ROOT" || "$REMOTE_ROOT" == *REPLACE* || "$REMOTE_ROOT" != /* ]] && out+=("remoteRoot")
  [[ -z "$IDENTITY" || ! -f "$IDENTITY" ]] && out+=("identityFile")
  printf '%s' "${out[*]:-}"
}

require_config() {
  local gaps; gaps="$(missing)"
  [ -z "$gaps" ] && return 0
  printf '[FAIL] config %s is incomplete: %s\n' "$CONFIG" "$gaps" >&2
  printf '        Set the server address (IP conflicts happen, so this is expected to change):\n' >&2
  printf '          scripts/storage.sh use --host <server-ip> --user <user> --root <remote-dir>\n' >&2
  printf '        First-time setup of the server and the SSH key: docs/SETUP.md\n' >&2
  exit 2
}

SSH_ARGS=()
build_ssh_args() {
  local mode="${1:-batch}"
  SSH_ARGS=(-p "$PORT" -o "IdentitiesOnly=yes" -o "ConnectTimeout=10" -o "StrictHostKeyChecking=accept-new" -o "LogLevel=ERROR" -o "ServerAliveInterval=30" -o "ServerAliveCountMax=3")
  [ -f "$IDENTITY" ] && SSH_ARGS+=(-i "$IDENTITY")
  [ "$mode" = "batch" ] && SSH_ARGS+=(-o "BatchMode=yes")
  return 0
}

# Turn a sub-path into an absolute path that is guaranteed to live under remoteRoot.
remote_path() {
  local sub="${1:-}"
  local path
  case "$sub" in
    "") path="$REMOTE_ROOT" ;;
    /*) path="$sub" ;;
    *) path="$REMOTE_ROOT/${sub#./}" ;;
  esac
  while [[ "$path" == *"//"* ]]; do path="${path//\/\//\/}"; done
  case "$path" in
    "$REMOTE_ROOT"|"$REMOTE_ROOT"/*) ;;
    *) die 4 "refusing path outside remoteRoot ($REMOTE_ROOT): $1" ;;
  esac
  case "$path" in *".."*) die 4 "refusing path containing '..': $1" ;; esac
  printf '%s' "$path"
}

rsync_remote() { printf '%s@%s:%s' "$USER_NAME" "$HOST" "$1"; }
rsync_ssh() { printf 'ssh %s' "${SSH_ARGS[*]}"; }

take_dry_run() {
  if [[ " $* " == *" --dry-run "* ]]; then DRY_RUN="--dry-run"; fi
}

cmd_config() {
  local gaps; gaps="$(missing)"
  say "config:       $CONFIG"
  say "host:         ${HOST:-<unset>}"
  say "user:         ${USER_NAME:-<unset>}"
  say "port:         $PORT"
  say "identityFile: ${IDENTITY:-<unset>}$([ -n "$IDENTITY" ] && [ -f "$IDENTITY" ] && echo ' (present)' || echo ' (MISSING)')"
  say "remoteRoot:   ${REMOTE_ROOT:-<unset>}"
  say "defaultSubdir:${DEFAULT_SUBDIR:-<unset>}"
  if [ -z "$gaps" ]; then say "status:       ready"; else say "status:       INCOMPLETE — unset: $gaps"; exit 2; fi
}

cmd_use() {
  local updates="{}" host_in="" user_in="" port_in="" root_in="" ident_in=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --host) host_in="${2:-}"; shift 2 ;;
      --user) user_in="${2:-}"; shift 2 ;;
      --port) port_in="${2:-}"; shift 2 ;;
      --root) root_in="${2:-}"; shift 2 ;;
      --identity) ident_in="${2:-}"; shift 2 ;;
      *) die 1 "use: unknown argument $1" ;;
    esac
  done
  updates="$(node -e '
    const args = process.argv.slice(1);
    const out = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i];
      const value = args[i + 1];
      if (value === undefined || value === "") continue;
      out[key] = key === "port" ? Number(value) : value;
    }
    console.log(JSON.stringify(out));
  ' \
    $([ -n "$host_in" ] && printf 'host %s ' "$host_in") \
    $([ -n "$user_in" ] && printf 'user %s ' "$user_in") \
    $([ -n "$port_in" ] && printf 'port %s ' "$port_in") \
    $([ -n "$root_in" ] && printf 'remoteRoot %s ' "$root_in") \
    $([ -n "$ident_in" ] && printf 'identityFile %s ' "$ident_in") \
  )" || die 1 "use: could not build updates"
  node -e '
    const fs = require("node:fs");
    const [file, json] = process.argv.slice(1);
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    Object.assign(data, JSON.parse(json));
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  ' "$CONFIG" "$updates" || die 2 "use: cannot write $CONFIG"
  say "updated $CONFIG"
  load_config
  sync_ssh_alias
  cmd_config
}

# The `Host lan-storage` block in ~/.ssh/config is a convenience for humans; this file stays
# authoritative. Keep the block's HostName/User in step so the two never disagree.
sync_ssh_alias() {
  local ssh_config="$HOME/.ssh/config"
  [ -f "$ssh_config" ] || return 0
  node -e '
    const fs = require("node:fs");
    const [file, host, user, port] = process.argv.slice(1);
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split("\n");
    let inside = false, touched = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*Host\s+/i.test(line)) { inside = /^\s*Host\s+lan-storage\s*$/i.test(line); continue; }
      if (!inside) continue;
      if (/^\s*HostName\s+/i.test(line)) { lines[i] = `  HostName ${host}`; touched = true; }
      else if (/^\s*User\s+/i.test(line)) { lines[i] = `  User ${user}`; touched = true; }
      else if (/^\s*Port\s+/i.test(line) && port !== "22") { lines[i] = `  Port ${port}`; touched = true; }
    }
    if (touched) fs.writeFileSync(file, lines.join("\n"));
    else console.error("note: no `Host lan-storage` block in ~/.ssh/config; ssh alias unchanged");
  ' "$ssh_config" "$HOST" "$USER_NAME" "$PORT" && say "synced ~/.ssh/config (Host lan-storage)"
}

cmd_check() {
  require_config
  build_ssh_args batch
  local rc=0
  say "config:  ok ($USER_NAME@$HOST:$PORT, root $REMOTE_ROOT)"

  if command -v nc >/dev/null 2>&1; then
    if nc -z -w 3 "$HOST" "$PORT" 2>/dev/null; then say "tcp:     open $HOST:$PORT"
    else say "tcp:     [FAIL] cannot reach $HOST:$PORT — wrong IP, DHCP moved it, or firewall"; rc=3; fi
  fi

  local whoami_out
  whoami_out="$(ssh "${SSH_ARGS[@]}" "$USER_NAME@$HOST" 'id -un' 2>&1)"
  if [ $? -ne 0 ]; then
    say "ssh:     [FAIL] $whoami_out"
    say "         key installed? scripts/gen-ssh-key.sh, then docs/SETUP.md step B3"
    exit 4
  fi
  say "ssh:     key-only auth ok as $whoami_out"

  local probe="$REMOTE_ROOT/.lan-agent-write-test"
  if ssh "${SSH_ARGS[@]}" "$USER_NAME@$HOST" "touch '$probe' && rm -f '$probe'" 2>/dev/null; then
    say "write:   ok ($REMOTE_ROOT writable)"
  else
    say "write:   [FAIL] $REMOTE_ROOT not writable by $USER_NAME (ownership, see docs/SETUP.md B2)"; rc=4
  fi

  local df_line
  df_line="$(ssh "${SSH_ARGS[@]}" "$USER_NAME@$HOST" "df -h '$REMOTE_ROOT' | tail -n 1" 2>/dev/null)"
  say "space:   $df_line"
  [ "$rc" -eq 0 ] && say "status:  READY"
  return "$rc"
}

cmd_df() {
  require_config; build_ssh_args batch
  ssh "${SSH_ARGS[@]}" "$USER_NAME@$HOST" "df -h '$(remote_path "${1:-}")'" || die 4 "df failed"
}

cmd_ls() {
  require_config; build_ssh_args batch
  ssh "${SSH_ARGS[@]}" "$USER_NAME@$HOST" "ls -la '$(remote_path "${1:-}")'" || die 4 "ls failed"
}

cmd_put() {
  take_dry_run "$@"
  require_config; build_ssh_args batch
  local to="" files=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --to) to="${2:-}"; shift 2 ;;
      --dry-run) shift ;;
      *) files+=("$1"); shift ;;
    esac
  done
  [ "${#files[@]}" -gt 0 ] || die 1 "put: no local files given"
  local dest; dest="$(remote_path "${to:-$DEFAULT_SUBDIR}")"
  rsync -av --partial $DRY_RUN -e "$(rsync_ssh)" "${files[@]}" "$(rsync_remote "$dest/")" || die 4 "rsync upload failed"
}

cmd_get() {
  take_dry_run "$@"
  require_config; build_ssh_args batch
  local args=(); for a in "$@"; do [[ "$a" == --dry-run ]] || args+=("$a"); done
  [ "${#args[@]}" -eq 2 ] || die 1 "get: usage: get <remote-sub> <local-dir>"
  local src; src="$(remote_path "${args[0]}")"
  mkdir -p "${args[1]}" || die 1 "get: cannot create ${args[1]}"
  rsync -av --partial $DRY_RUN -e "$(rsync_ssh)" "$(rsync_remote "$src")" "${args[1]}/" || die 4 "rsync download failed"
}

cmd_sync() {
  take_dry_run "$@"
  require_config; build_ssh_args batch
  local args=() delete=""
  for a in "$@"; do
    case "$a" in
      --dry-run) ;;
      --delete) delete="--delete" ;;
      *) args+=("$a") ;;
    esac
  done
  [ "${#args[@]}" -eq 2 ] || die 1 "sync: usage: sync <local-dir> <remote-sub> [--delete]"
  [ -d "${args[0]}" ] || die 1 "sync: ${args[0]} is not a directory"
  local dest; dest="$(remote_path "${args[1]}")"
  rsync -av --partial $DRY_RUN $delete -e "$(rsync_ssh)" "${args[0]}/" "$(rsync_remote "$dest/")" || die 4 "rsync sync failed"
}

cmd_rm() {
  take_dry_run "$@"
  require_config; build_ssh_args batch
  local paths=() p
  for a in "$@"; do [[ "$a" == --dry-run ]] || paths+=("$a"); done
  [ "${#paths[@]}" -gt 0 ] || die 1 "rm: give at least one path under remoteRoot"
  for p in "${paths[@]}"; do
    local full; full="$(remote_path "$p")"
    [ "$full" = "$REMOTE_ROOT" ] && die 4 "rm: refusing to delete remoteRoot itself"
    if [ -n "$DRY_RUN" ]; then say "would delete $full"; else
      ssh "${SSH_ARGS[@]}" "$USER_NAME@$HOST" "rm -rf -- '$full'" || die 4 "rm failed: $full"
      say "deleted $full"
    fi
  done
}

cmd_ssh() {
  require_config; build_ssh_args batch
  [ $# -gt 0 ] || die 1 "ssh: give a command to run"
  ssh "${SSH_ARGS[@]}" "$USER_NAME@$HOST" "$@" || die 4 "remote command failed"
}

cmd_shell() {
  require_config; build_ssh_args interactive
  exec ssh "${SSH_ARGS[@]}" "$USER_NAME@$HOST"
}

usage() { sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

main() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    ""|-h|--help|help) usage; exit 0 ;;
  esac
  load_config
  case "$cmd" in
    config) cmd_config ;;
    use) cmd_use "$@" ;;
    check) cmd_check ;;
    df) cmd_df "$@" ;;
    ls) cmd_ls "$@" ;;
    put) cmd_put "$@" ;;
    get) cmd_get "$@" ;;
    sync) cmd_sync "$@" ;;
    rm) cmd_rm "$@" ;;
    ssh) cmd_ssh "$@" ;;
    shell) cmd_shell ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
