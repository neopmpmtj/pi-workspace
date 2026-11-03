#!/usr/bin/env bash
# gen-ssh-key.sh — create (or reuse) the storage SSH keypair and print the exact
# commands that install it on the file server.
#
#   scripts/gen-ssh-key.sh                 generate if absent, print pubkey + install steps
#   scripts/gen-ssh-key.sh --force         regenerate (invalidates the key already installed)
#   scripts/gen-ssh-key.sh --identity F    use a different key path
#   scripts/gen-ssh-key.sh --passphrase     protect the key (breaks unattended runs)
#
# Key path and server values come from config/storage.json, so the printed
# commands match what scripts/storage.sh will actually use.

set -uo pipefail

HOME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${STORAGE_CONFIG:-$HOME_DIR/config/storage.json}"

FORCE=""; IDENTITY=""; PASSPHRASE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --identity) IDENTITY="${2:-}"; shift 2 ;;
    --passphrase) PASSPHRASE=1; shift ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "[FAIL] unknown argument: $1" >&2; exit 1 ;;
  esac
done

HOST=""; USER_NAME=""; PORT="22"; REMOTE_ROOT=""
if [ -f "$CONFIG" ]; then
  dump="$(node -e '
    const fs = require("node:fs");
    let d = {};
    try { d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(0); }
    for (const k of ["host","user","port","remoteRoot"]) if (d[k] != null && String(d[k]).trim()) console.log(k + "\t" + String(d[k]).trim());
  ' "$CONFIG")"
  while IFS=$'\t' read -r k v; do
    case "$k" in host) HOST="$v" ;; user) USER_NAME="$v" ;; port) PORT="$v" ;; remoteRoot) REMOTE_ROOT="$v" ;; esac
  done <<< "$dump"
fi

[ -n "$IDENTITY" ] || IDENTITY="$(node -e '
  const fs = require("node:fs");
  let d = {};
  try { d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
  console.log(typeof d.identityFile === "string" && d.identityFile.trim() ? d.identityFile.trim() : "~/.ssh/id_ed25519_lan-storage");
' "$CONFIG")"
case "$IDENTITY" in "~/"*) IDENTITY="$HOME/${IDENTITY#\~/}" ;; esac

if [ -f "$IDENTITY" ] && [ -z "$FORCE" ]; then
  echo "key already present: $IDENTITY (use --force to regenerate)"
else
  [ -f "$IDENTITY" ] && { mv "$IDENTITY" "$IDENTITY.bak.$(date +%s)"; mv "$IDENTITY.pub" "$IDENTITY.pub.bak.$(date +%s)"; echo "old key moved aside (*.bak.*)"; }
  mkdir -p "$(dirname "$IDENTITY")"
  KEYGEN=(-t ed25519 -a 100 -f "$IDENTITY" -C "pi-lan-agent@$(hostname -s)")
  [ -n "$PASSPHRASE" ] || KEYGEN+=(-N "")
  ssh-keygen "${KEYGEN[@]}" >/dev/null || { echo "[FAIL] ssh-keygen failed" >&2; exit 1; }
  echo "generated: $IDENTITY"
fi
chmod 600 "$IDENTITY"

echo
echo "public key:"
cat "$IDENTITY.pub"
echo
echo "fingerprint: $(ssh-keygen -lf "$IDENTITY.pub" | awk '{print $2}')"
echo
echo "--- install it on the file server (one interactive login, as root/admin) ---"
SHOWN_HOST="${HOST:-<SERVER_IP>}"; SHOWN_USER="${USER_NAME:-pistore}"
case "$SHOWN_HOST" in *REPLACE*|"") SHOWN_HOST="<SERVER_IP>" ;; esac
case "$SHOWN_USER" in *REPLACE*|"") SHOWN_USER="pistore" ;; esac

echo "1) from this laptop, one password prompt:"
echo "   ssh-copy-id -i $IDENTITY.pub -p $PORT $SHOWN_USER@$SHOWN_HOST"
echo
echo "2) or on the server, as root/admin (equivalent, no password needed):"
echo "   install -d -m 700 -o $SHOWN_USER -g $SHOWN_USER /home/$SHOWN_USER/.ssh"
echo "   echo '$(cat "$IDENTITY.pub")' > /home/$SHOWN_USER/.ssh/authorized_keys"
echo "   chown $SHOWN_USER:$SHOWN_USER /home/$SHOWN_USER/.ssh/authorized_keys"
echo "   chmod 600 /home/$SHOWN_USER/.ssh/authorized_keys"
echo "   chmod go-w /home/$SHOWN_USER"
echo
echo "3) verify from this laptop (no prompts allowed):"
echo "   ssh -o BatchMode=yes -i $IDENTITY -p $PORT $SHOWN_USER@$SHOWN_HOST 'id; df -h ${REMOTE_ROOT:-/srv/pi-storage}'"
echo
echo "4) record where things live, then re-run the full check:"
echo "   scripts/storage.sh use --host $SHOWN_HOST --user $SHOWN_USER --root ${REMOTE_ROOT:-/srv/pi-storage}"
echo "   scripts/storage.sh check"
echo
echo "Server-side details (user creation, mounting the data disk, sshd hardening, firewall):"
echo "   $HOME_DIR/docs/SETUP.md"
