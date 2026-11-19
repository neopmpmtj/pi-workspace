#!/usr/bin/env bash
# fingerprint.sh — print this host's installation fingerprint as KEY=value lines.
#
# Used by publish-fingerprint.sh (laptop → VPS over ssh) and parity-alert.sh
# (VPS compares its own fingerprint with the last published one). Offline, cheap,
# no network, no model tokens.

set -uo pipefail

. "$HOME/.pi/scripts/env.sh" 2>/dev/null || true

cd "${PI_REPO:-$HOME/.pi}" 2>/dev/null || exit 1

pkgver() { node -e "try{console.log(require('$PWD/agent/npm/node_modules/@llblab/pi-telegram/package.json').version)}catch{console.log('none')}" 2>/dev/null || echo none; }
devver() { node -e "const r=p=>{try{return require('$PWD/agent/node_modules/'+p+'/package.json').version}catch{return 'none'}};console.log(['@earendil-works/pi-ai','@earendil-works/pi-coding-agent','typebox','typescript'].map(p=>p.split('/').pop()+'@'+r(p)).join(','))" 2>/dev/null || echo none; }
settings_hash() { node -e "const s=require('$PWD/agent/settings.json');const c={e:s.extensions,p:s.packages,m:s.enabledModels,dp:s.defaultProvider,dm:s.defaultModel};process.stdout.write(require('node:crypto').createHash('sha256').update(JSON.stringify(c)).digest('hex').slice(0,12))" 2>/dev/null || echo none; }

echo "HOST=$(hostname -s 2>/dev/null || echo unknown)"
echo "AT=$(date -u +%FT%TZ)"
echo "HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo none)"
echo "BEHIND=$(git rev-list --count HEAD..@{u} 2>/dev/null || echo '?')"
echo "PI=$(pi --version 2>/dev/null || echo none)"
echo "NODE=$(node -v 2>/dev/null || echo none)"
echo "NPM_PKGS=$(ls agent/npm/node_modules 2>/dev/null | grep -vc '^\\.' || echo 0)"
echo "TELEGRAM=$(pkgver)"
echo "SUBMODULES=$(git submodule status 2>/dev/null | awk '{print $1}' | tr -d '+-U' | md5sum | cut -c1-12)"
echo "SETTINGS=$(settings_hash)"
echo "DEVDEPS=$(devver)"
