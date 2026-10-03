# gog-workspace Portable Install — Setup & Debug Report

**Date:** 2026-10-03
**System:** Dev: Ubuntu 24.04.5 LTS x86_64 (Pi v1.0.0, node v24.21.0, gog v0.34.0) · VPS `neopmpmtj`: Ubuntu 24.04.4 LTS x86_64 (Pi v1.0.0, node v22.22.2, gog v0.34.0)
**Location:** `~/.pi/agent/skills/gog-workspace/` → repo `neopmpmtj/skill-gog-workspace` (private) · runtime state `~/.local/share/gogcli/` + `~/.config/gogcli/` · secrets `~/.pi/agent/.env`

---

## Problem

The goal was a **repeatable, plug-and-play Google Workspace setup**: install Pi Agent on any fresh Ubuntu server, clone the `gog-workspace` skill, put the Google Console credentials in `.env`, and have the agent read Gmail, Calendar and Drive — the same recipe to be reused for friends and family.

Three things were missing or wrong:

1. **No from-scratch instructions.** `scripts/bootstrap.sh` (upstream) assumed Homebrew and pointed at a dead tap (`steipete/tap/gogcli`) and a stale release repo, while upstream had moved to `openclaw/gogcli`. A bare Ubuntu VPS has no Homebrew and no browser.
2. **The mental model was incomplete.** "Clone + fill `.env`" cannot work: `.env` carries only the keyring *password*. The OAuth **client** and the OAuth **refresh token** live outside `.env`, and the refresh token is the stateful part that actually authenticates the account.
3. **gog was, in fact, already broken everywhere** — `oauth2: "deleted_client" "The OAuth client was deleted."` — so the recipe could not be validated until the Console side was recreated.

This work was the first real deployment of the new per-skill-repo layout established earlier in the session (each skill in `~/.pi/agent/skills/<name>/` is its own private GitHub repo), and the guide now ships *inside* that repo so every clone gets it.

---

## Investigation / Root Cause

No web research was needed; everything was established by direct probing of the live CLI, the live release assets, and byte-level comparison between the two machines. The chain of findings:

| # | Symptom | Root cause | Evidence that proved it |
|---|---|---|---|
| 1 | `oauth2: "deleted_client" "The OAuth client was deleted."` on dev **and** VPS | The OAuth client behind the stored refresh token was deleted in Google Cloud | `gog auth doctor` → `status ok` (keyring, password, token all readable) while `gog gmail list` returned the API error — i.e. auth storage fine, client gone |
| 2 | "Verification" commands appeared to fail | `gog gmail list` **requires a query** (`expected "<query> ..."`); the failures were *usage* errors, not auth errors | `gog gmail list --help` → `Arguments: <query> ...`; `gog gmail list is:unread --plain` returned data on dev |
| 3 | VPS: `aes.KeyUnwrap(): integrity check failed` with the **correct** password | `~/.config/gogcli/keyring/` (OpenClaw-era leftover) **hijacks keyring resolution**: gog resolves `keyring.dir` to the legacy path instead of `~/.local/share/gogcli/keyring` | `gog auth doctor` printed `keyring.dir /home/pmpmt/.config/gogcli/keyring`; keyring files were byte-identical (sha256) and password hashes identical on both machines |
| 4 | VPS agent used **gog v0.12.0** and failed with `unexpected argument doctor` | Two PATH bugs: (a) `brew shellenv` in `~/.bashrc` prepends linuxbrew; (b) the `~/bin/pi` launcher's `for` loop **prepends in reverse**, so the last entry (`/home/linuxbrew/.linuxbrew/bin`) ended up first | `pi --print 'echo $PATH'` showed linuxbrew ahead of `~/.pi/agent/bin`; `command -v gog` inside the agent resolved to `/home/linuxbrew/.linuxbrew/bin/gog` |
| 5 | Legacy keyring dir **reappeared** after being moved aside | The old v0.12 binary (still winning on PATH) wrote token entries into the legacy location using its plaintext item naming | Recreated dir contained `token:default:neopmpmtj@gmail.com` (plaintext, not base64) — v0.34 uses base64 item filenames |
| 6 | Transplanted keyring landed mode 644 | `scp` does not preserve modes | `ls -l` on the VPS after `scp -r` |

Diagnostic techniques worth reusing:

```bash
# which binary is the agent actually using, and where does it point its keyring?
pi --print 'run: command -v gog; gog --version; gog auth doctor'
# distinguish "wrong password" from "wrong keyring path"
gog auth doctor | grep keyring.dir
# are the transplanted files really identical?
sha256sum ~/.local/share/gogcli/keyring/_gogcli_key_v1_*
# compare the *effective* password (later .env assignments win when sourcing)
set -a; . ~/.pi/agent/.env; set +a; printf %s "$GOG_KEYRING_PASSWORD" | sha256sum
```

### The state model that the diagnosis produced

| Piece | Path | Secret? | Portable by copy? |
|---|---|---|---|
| `gog` binary | `~/.pi/agent/bin/gog` | no | re-download (pinned, checksum-verified) |
| OAuth **client** | `~/.local/share/gogcli/credentials.json` | semi | copy, or `gog auth credentials set` |
| OAuth **token** + client secret | `~/.local/share/gogcli/keyring/` | **yes** | copy **with the same** `GOG_KEYRING_PASSWORD` |
| gog config | `~/.config/gogcli/config.json` | no | written by `install.sh` |
| Env | `~/.pi/agent/.env` | **yes** | re-enter (`GOG_ACCOUNT`, `GOG_KEYRING_BACKEND`, `GOG_KEYRING_PASSWORD`) |

Verified release facts: upstream `openclaw/gogcli` (formerly `steipete/gogcli` — both names resolve to the same asset), latest `v0.43.0` (2026-10-01), assets `gogcli_<ver>_linux_{amd64,arm64}.tar.gz` plus `checksums.txt`; the tarball contains a single self-contained Go binary.

---

## Architecture / Design Decisions

| Decision | Chosen | Alternatives | Why |
|---|---|---|---|
| Where the guide lives | **Inside the skill repo** (`INSTALL.md`) | A doc in `~/.pi/docs/` | The skill repo is the distribution unit; any clone on any machine gets the instructions with the code |
| gog version | **Pin v0.34.0**, checksum-verified, `GOG_VERSION` overridable | Install latest (v0.43.0) | Parity with the keyring format and the `SKILL.md` recipes that were verified against it; upgrades documented separately (flags can drift) |
| Install method | **Direct release tarball into `~/.pi/agent/bin/gog`** | Homebrew (upstream `bootstrap.sh`) | Works on a bare Ubuntu VPS with no sudo and no Homebrew; the old tap is dead |
| Deliverable shape | **Guide + idempotent script** | Guide only | "Instructions + plug and play": humans read §3 (Console), the script does the mechanical part |
| Auth path | **Transplant first, headless flow as recovery** | Fresh auth everywhere | Transplant is genuinely zero-interaction across machines; `--remote --step 1/2` covers machines with no prior state |
| OAuth app mode | **Require Published** + daily keepalive cron | Testing mode | In Testing, Google expires refresh tokens after 7 days — a server would silently lose access |
| `bootstrap.sh` | Left in place, marked upstream/reference | Rewrite it | Preserves upstream fidelity while `INSTALL.md` + `install.sh` are canonical |

`install.sh` design: idempotent, never overwrites existing `.env` keys, generates a keyring password only when none exists (and warns that a transplant must reuse the *source* password), verifies the release checksum before installing, and warns about both legacy gog state and a shadowing `gog` binary.

---

## Implementation

### Phase 1 — Reconnaissance
- Cloned all six skills onto the VPS as real repos and validated frontmatter; compared the pre-existing VPS copies against GitHub (`pi-prompt-dump`, `skill-creator`, `yt-download` byte-identical; `gog-workspace` older and carrying a VPS-only `references/pi-install-notes.md`, whose content was salvaged before the copy was replaced).
- Verified the release URL/checksum/extraction locally *before* writing any commands into the guide.
- Verified the live CLI surface (`gog auth credentials set <file|->`, `gog auth add --manual|--remote --step 1|2`, `--services`, `--force-consent`, `gog auth doctor`, `gog schema`).

### Phase 2 — Authoring
```
~/.pi/agent/skills/gog-workspace/
├── INSTALL.md                 # 354 lines — canonical from-scratch guide (§0 TL;DR … §10 hygiene)
├── SKILL.md                   # +18/-1 — First-Time Setup now points at INSTALL.md; discovery step 4 = confirm the binary
└── scripts/
    ├── install.sh             # 176 lines — pinned, checksum-verified, idempotent installer
    └── gog-keepalive.sh       # 31 lines  — daily token refresh for cron
```
`INSTALL.md` sections: TL;DR · prerequisites · state model · Google Cloud Console (project → APIs → consent screen **Published** → Desktop client) · launcher/`.env` · client + auth (§5A transplant, §5B headless) · keepalive cron · verification · troubleshooting · upgrade · secrets hygiene.

`scripts/install.sh` core pattern:

```bash
GOG_VERSION="${GOG_VERSION:-0.34.0}"
asset="gogcli_${GOG_VERSION}_${os}_${arch}.tar.gz"
curl -fsSL -o "$tmp/$asset" "$base/$asset"
expected="$(grep " $asset\$" "$tmp/checksums.txt" | awk '{print $1}')"
[ "$expected" = "$(sha256sum "$tmp/$asset" | awk '{print $1}')" ] || die "checksum mismatch"
install -m 0755 "$tmp/gog" "$BIN_DIR/gog"

set_kv() { grep -qE "^$1=" "$ENV_FILE" && ok "$1 already set" || { printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; ok "$1 added"; }; }
set_kv GOG_KEYRING_BACKEND file
```

Guardrails added after testing:
- warns if `~/.config/gogcli/{keyring,credentials.json}` exists (legacy hijack),
- warns if another `gog` is on `PATH` (shadowing),
- warns if the launcher does not appear to source `.env`.

### Phase 3 — Greenfield install on the VPS, executed strictly from the guide

```bash
# §4.2
git clone git@github.com:neopmpmtj/skill-gog-workspace.git ~/.pi/agent/skills/gog-workspace
GOG_ACCOUNT='neopmpmtj@gmail.com' bash ~/.pi/agent/skills/gog-workspace/scripts/install.sh
# §5A transplant (from the authorized dev machine)
scp -r ~/.local/share/gogcli/credentials.json "$NEW":~/.local/share/gogcli/
scp -r ~/.local/share/gogcli/keyring/         "$NEW":~/.local/share/gogcli/
# §6 keepalive
#   crontab: 0 8 * * * $HOME/.pi/agent/skills/gog-workspace/scripts/gog-keepalive.sh >> $HOME/.pi/gog-keepalive.log 2>&1
```

VPS-side changes required (now documented in the guide):

| Change | Reason |
|---|---|
| `~/.config/gogcli/keyring` → `keyring.legacy-20261003` | stop legacy keyring hijack |
| `~/.config/gogcli/credentials.json` → `credentials.json.legacy-<ts>` | same; legacy client file drove the legacy keyring path |
| `~/bin/pi` PATH loop reordered (linuxbrew … `.pi/agent/bin` **last**) | loop prepends, so last entry wins → pinned gog first |
| `~/.bashrc` += `export PATH="$HOME/.pi/agent/bin:$PATH"` (after `brew shellenv`) | interactive shells were also shadowed |

### Phase 4 — Re-authorization (Console, user-driven) and re-transplant
1. New **Desktop app** OAuth client + consent screen **Published**.
2. `gog auth credentials set ~/Downloads/client_secret_*.json`
3. `gog auth add neopmpmtj@gmail.com --force-consent --services gmail,calendar,drive`
4. Re-transplanted `credentials.json` + `keyring/` to the VPS, then `chmod 700/600` (scp does not preserve modes).

---

## Verification

| Check | Dev machine | VPS |
|---|---|---|
| `gog --version` | v0.34.0 (83637875) | v0.34.0 (83637875) |
| `gog auth doctor` | `status ok` | `keyring.dir ~/.local/share/gogcli/keyring` · `status ok` |
| `gog gmail list is:unread --max 5 --plain` | real rows | 5 rows |
| `gog drive ls --plain` | real rows | 20 items |
| `gog calendar calendars --plain` | — | 3 calendars |
| `scripts/gog-keepalive.sh` | — | `keepalive OK` |
| **Agent-level** (`pi --print 'run: …'`) | — | agent's own shell ran `gog gmail list is:unread` and returned real messages ✅ |

The agent-level test is the one that matters: it proves the launcher exports the keyring password **and** the pinned binary wins on the agent's PATH — an assertion a human shell cannot make.

---

## Files Created/Modified

| File | Lines | Purpose |
|---|---|---|
| `~/.pi/agent/skills/gog-workspace/INSTALL.md` | 354 | Canonical from-scratch guide (Console → install → auth → verify → keepalive) |
| `~/.pi/agent/skills/gog-workspace/scripts/install.sh` | 176 | Idempotent installer: pinned checksum-verified binary, `.env` prep, legacy/shadow warnings |
| `~/.pi/agent/skills/gog-workspace/scripts/gog-keepalive.sh` | 31 | Daily token refresh; exits non-zero when re-auth is needed |
| `~/.pi/agent/skills/gog-workspace/SKILL.md` | +18 / −1 | Points setup at `INSTALL.md`; adds "confirm which binary answers" to the discovery protocol |
| **Total (repo)** | **+578 / −1** | 4 commits: `e664edb`, `5c7f19f`, `b0e285f`, `ffb09c3` (on `c550b78`) |

Machine-side changes (not in git):

| Target | Change |
|---|---|
| VPS `~/.pi/agent/skills/*` | six skills replaced with git clones (backup of the old copies not kept, by request) |
| VPS `~/.pi/agent/bin/gog` | pinned v0.34.0 installed |
| VPS `~/.pi/agent/.env` | `GOG_KEYRING_BACKEND=file` added; `GOG_KEYRING_PASSWORD` set to the source value |
| VPS `~/bin/pi` | PATH loop reordered (backup: `pi.bak-<ts>`) |
| VPS `~/.bashrc` | trailing `export PATH="$HOME/.pi/agent/bin:$PATH"` (backup: `.bashrc.bak-<ts>`) |
| VPS `crontab` | keepalive line added |
| VPS `~/.local/share/gogcli/` | `credentials.json` + `keyring/` transplanted, modes 600/700 |
| VPS `~/.config/gogcli/` | legacy `keyring` and `credentials.json` moved aside |

---

## Troubleshooting Quick Reference

| Symptom | Cause | Fix |
|---|---|---|
| `oauth2: "deleted_client"` | OAuth client no longer exists in Google Cloud | create a new Desktop client (§3.5), `auth credentials set`, `auth add --force-consent`; a transplant cannot fix it |
| `aes.KeyUnwrap(): integrity check failed` | wrong keyring password **or** legacy keyring being read | verify password hash equality; move `~/.config/gogcli/{keyring,credentials.json}` aside |
| `Secret not found in keyring (refresh token missing)` / `keyring.dir` points at `~/.config/gogcli/keyring` | legacy state hijacking resolution | same as above |
| `unexpected argument <flag>` on a command that should exist | older `gog` shadowing the pinned one | fix PATH order (§4.1); confirm with `pi --print 'command -v gog'` |
| `expected "<query> ..."` | `gog gmail list` needs a query | `gog gmail list is:unread …` |
| `no TTY available for keyring … prompt` | `GOG_KEYRING_PASSWORD` not exported | launcher must source `.env` |
| Auth works, dies after ~7 days | OAuth app in Testing | publish the app; keep the keepalive cron |

---

## Limitations & Future Work

- **§5B (`--remote --step 1|2`) not exercised live** — documented from `gog auth add --help`; it needs a machine with no prior credentials to test properly. Verify on the next fresh target.
- **gog upgrade path untested** — `GOG_VERSION=0.43.0` is documented but the `SKILL.md` recipes have not been re-verified against newer flags.
- **Per-person onboarding** (friends/family) still requires the three person-specific inputs: their Google account, their `client_secret.json`, their keyring password. Everything else is scripted.
- The same per-skill-repo pattern is not yet rolled out to the VPS's *other* machines/partner agents; `skill-gog-workspace` is the reference implementation.
