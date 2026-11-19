#!/usr/bin/env bash
# check-host-parity.sh — compare this host's agent installation with the VPS.
#
# Prints one row per fact and exits non-zero when the two hosts disagree.
# Used by docs/runbooks/host-parity-laptop-vps.md.
#
# Usage: bash ~/.pi/scripts/check-host-parity.sh [remote]     (default remote: neopmpmtj)

set -uo pipefail

REMOTE="${1:-neopmpmtj}"
NODE_BIN="$HOME/.nvm/versions/node/v24.21.0/bin"
HOME_DIR="$HOME/.pi"

probe() {
  # $1 = command to run; local when $2 == local, otherwise over ssh
  local cmd="$1" where="${2:-local}"
  if [ "$where" = local ]; then
    bash -lc "$cmd" 2>/dev/null
  else
    ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE" "$cmd" 2>/dev/null
  fi
}

# Keep the probes identical on both sides: no interactive shell config, explicit PATH.
BODY=$(cat <<'EOS'
set -u
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
echo "HEAD=$(git -C "$HOME/.pi" rev-parse --short HEAD 2>/dev/null || echo none)"
echo "BEHIND=$(git -C "$HOME/.pi" rev-list --count HEAD..@{u} 2>/dev/null || echo '?')"
echo "DIRTY=$(git -C "$HOME/.pi" status --porcelain 2>/dev/null | grep -vc '^ D')"
echo "PI=$(pi --version 2>/dev/null || echo none)"
echo "NODE=$(node -v 2>/dev/null || echo none)"
echo "NPM_PKGS=$(ls "$HOME/.pi/agent/npm/node_modules" 2>/dev/null | grep -v '^\.' | wc -l | tr -d ' ')"
echo "TELEGRAM=$(node -e 'console.log(require(process.env.HOME+"/.pi/agent/npm/node_modules/@llblab/pi-telegram/package.json").version)' 2>/dev/null || echo none)"
echo "LOCK=$(node -e 'const p=require(process.env.HOME+"/.pi/agent/npm/package-lock.json");console.log(p.packages["node_modules/@llblab/pi-telegram"]?.version||"none")' 2>/dev/null || echo none)"
echo "SUBMODULES=$(git -C "$HOME/.pi" submodule status 2>/dev/null | awk '{print $1}' | tr -d '+-U' | md5sum | cut -c1-12)"
echo "SUB_INIT=$(git -C "$HOME/.pi" submodule status 2>/dev/null | grep -vc '^-')"
echo "SETTINGS_CORE=$(node -e 'const s=require(process.env.HOME+"/.pi/agent/settings.json");const core={extensions:s.extensions,packages:s.packages,enabledModels:s.enabledModels,defaultProvider:s.defaultProvider,defaultModel:s.defaultModel};process.stdout.write(require("node:crypto").createHash("sha256").update(JSON.stringify(core)).digest("hex").slice(0,12))' 2>/dev/null || echo none)"
echo "SETTINGS_EXT=$(node -e 'const s=require(process.env.HOME+"/.pi/agent/settings.json");console.log((s.extensions||[]).length+" ext,"+(s.packages||[]).length+" pkg,"+(s.enabledModels||[]).length+" models")' 2>/dev/null || echo none)"
echo "DEVDEP_NM=$([ -d "$HOME/.pi/agent/node_modules" ] && echo present || echo absent)"
echo "DEVDEP_VER=$(node -e 'const r=p=>{try{return require(process.env.HOME+"/.pi/agent/node_modules/"+p+"/package.json").version}catch{return "none"}};console.log(["@earendil-works/pi-ai","@earendil-works/pi-coding-agent","typebox","typescript"].map(p=>p.split("/").pop()+"@"+r(p)).join(","))' 2>/dev/null || echo none)"
EOS
)

LOCAL_OUT=$(probe "$BODY" local)
REMOTE_OUT=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE" "$BODY" 2>/dev/null)

if [ -z "$REMOTE_OUT" ]; then
  echo "cannot reach $REMOTE over ssh" >&2
  exit 2
fi

printf '%-12s %-42s %-42s %s\n' FACT LOCAL REMOTE OK
rc=0
while IFS='=' read -r key value; do
  [ -z "$key" ] && continue
  rval=$(printf '%s\n' "$REMOTE_OUT" | awk -F= -v k="$key" '$1==k {sub(/^[^=]*=/,""); print; exit}')
  if [ "$value" = "$rval" ]; then ok=yes; else ok=DIFF; rc=1; fi
  printf '%-12s %-42s %-42s %s\n' "$key" "${value:-?}" "${rval:-?}" "$ok"
done <<< "$LOCAL_OUT"

[ "$rc" -eq 0 ] && echo "parity: OK" || echo "parity: differences above"
exit "$rc"
