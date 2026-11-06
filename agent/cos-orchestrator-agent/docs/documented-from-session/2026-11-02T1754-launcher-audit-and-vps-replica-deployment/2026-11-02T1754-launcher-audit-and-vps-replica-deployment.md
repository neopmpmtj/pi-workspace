# Agent Launcher Audit & VPS Replica Deployment — Setup & Implementation Report

**Date:** 2026-11-02
**System:** Laptop Ubuntu 24.04.5 LTS (`pmpmt`) · VPS `neopmpmtj` (100.85.79.17, Ubuntu 24.04.4 LTS, x86_64) · Pi v1.4.0 · Node v24.21.0 via nvm
**Location:** launchers `~/.local/bin/{pi,pi-cos-orchestrator-agent,pi-web-master,pi-sm-google-workspace,pi-image-describer,pi-explore-discover-pi}`; agent homes under `~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent`, `~/.pi/agent-web-master/web-master`, `~/.pi/agent-gog-workspace-agents/sm-google-workspace/sm-google-workspace`, `~/.pi/agent-image-describer/image-describer`; repo `~/.pi` (branch `main`)

---

## Problem

The `~/.local/bin` launchers had just been edited (git sync moved out of `pi` into the
chief-of-staff launcher, per-agent `.env` isolation added). The request was an audit: check
that the six launchers actually work, then fix what the audit found. The audit produced six
findings, four of which needed code or configuration changes, one of which was a decision
about identity, and one a manifest gap.

The second half of the session was deployment: put the same launchers on the VPS replica,
which by then was stale in three independent ways — 7 commits behind `main`, still using the
**pre-rename** directory names (`~/.pi/web-master/…`, `~/.pi/cos-orchestrator-agent/…`), and
holding only two launchers.

Success criteria: identical launcher files on both machines, every launcher authenticating on
both machines, and no secrets copied between them.

---

## Investigation / Root Cause

The audit was mechanical — syntax check, run each launcher, inspect each home's configuration
against the code that reads it — plus two credential probes that cost no model tokens
(`pi auth print-api-key`, and `--version`). Findings:

| # | Finding | Root cause | Evidence |
|---|---|---|---|
| 1 | `gpt-6.1-sol` enabled but unusable | `.env` held only `DEEPSEEK_API_KEY` + `GEMINI_API_KEY`; `auth.json` had only `deepseek` and `gemini` entries | `pi auth print-api-key --provider openai` exited 1 at first audit |
| 2 | sm-google-workspace's saved effort silently ignored | `default-model.json` used the key `effort`, but that agent's `src/default-model.ts` and its launcher both read `thinking` | file content vs. `readDefaultModel()` |
| 3 | `~/.local/bin/pi` sourced `~/.pi/agent/.env` | that file no longer exists after the CoS takeover; bare `pi` only worked because `~/.pi/agent/auth.json` carries an inline deepseek key | `[ -f "$ENV_FILE" ] && source` is a silent no-op |
| 4 | Which `pi` you get depends on shell type | login shell puts `~/.local/bin` first (`.profile`), non-login shell puts nvm's bin first (`.bashrc` → nvm) | `bash -lc 'command -v pi'` → wrapper; tool shell → nvm binary |
| 5 | Manifest/doc drift | CoS home had no `agent.json`; `~/AGENTS.md` still pointed at `~/.pi/agent/{AGENTS,APPEND_SYSTEM}.md`, which the takeover emptied | `ls`, `grep` |
| 6 | web-master's saved model outside its own picker scope | `default-web-master-model.json` pins `gemini-3.6-flash`; `enabledModels` listed only 3.7 and 3.8 | catalog confirmed 3.6 still exists |

Two behaviours had to be established empirically rather than assumed:

- **`enabledModels` is not an authorisation gate.** `docs/models.md` and
  `dist/core/model-resolver.js` show the list scopes startup selection and cycling; an explicit
  `--model` still resolves. So the launcher's `--model gemini-3.6-flash` works while the
  picker stays narrower — item 6 was a consistency fix, not a breakage.
- **Env-var auth works without an `auth.json` entry.** `docs/models.md` orders credential
  sources as `--api-key` → `auth.json` → `models.json` `apiKey` → provider env var. A
  scratch-home live call proved it: `PI_CODING_AGENT_DIR=$(mktemp -d) pi --model gpt-6.1-sol -p …`
  → `ok`, once `OPENAI_API_KEY` was in the environment.

The VPS half was diagnosed read-only over SSH. The first pass produced a wrong conclusion —
`ls -d ~/.pi/*` appeared to show four entries because the launcher listing ahead of it had
consumed the output cap, so I reported "the replica has no homes" and then "the branch is
divergent". Both were wrong and were corrected: `git rev-list --count d4fc979..HEAD` = 7,
`git rev-list --count origin/main..HEAD` = 0, clean tree, so it was a plain fast-forward.

---

## Architecture / Design Decisions

### One identity or two (`pi`)

`~/.local/bin/pi` had become a stub that sourced a missing file and started `~/.pi/agent`,
which now holds harness state only (`auth.json`, `settings.json`, `models-store.json`,
`sessions/`, `trust.json`). Three options were weighed:

| Option | Effect | Cost |
|---|---|---|
| **A. Delegate** — `exec "$HOME/.local/bin/pi-cos-orchestrator-agent" "$@"` | one identity, one copy of the keys, kills finding 4 too | legacy home needs an explicit `PI_CODING_AGENT_DIR` to reach |
| B. Recreate `~/.pi/agent/.env` | bare debug identity restored | a second on-disk copy of three live keys; still two identities |
| C. Delete wrapper + legacy home | cleanest | loses the reachable bare home and its `sessions/` |

**Chosen: A**, on the user's instruction (`3a`). The delegate does not recurse: the launcher
execs `$NODE_BIN/pi`, the real bundle, not the wrapper.

### The model-file key name is per agent, not global

`effort` and `thinking` both appear in this estate, and each is correct in its own home:

| Agent | File | Key its own code reads | Launcher reads |
|---|---|---|---|
| cos-orchestrator-agent | `default-model.json` | `thinking` (`src/default-model.ts:44`) | `thinking` |
| sm-google-workspace | `default-model.json` | `thinking` | `thinking` |
| web-master | `default-web-master-model.json` | `effort` (`src/default-model.ts:33`) | `effort` |

So web-master is not a bug to normalise — it is the `effort` variant. The VPS's
`gog-workspace-agents/…/default-model.json` never existed, and sm's laptop file was rewritten
in place to `thinking` (`high` preserved), which is what its reader expects.

### `NODE_BIN` instead of a literal path

Every launcher hardcoded `/home/pmpmt/.nvm/versions/node/v24.21.0/bin`, contradicting the
"same file on every machine" claim in the CoS launcher's header. Replaced with:

```bash
NODE_BIN="${PI_NODE_BIN:-$HOME/.nvm/versions/node/v24.21.0/bin}"
export PATH="$NODE_BIN:$PATH"
exec "$NODE_BIN/pi" "${ARGS[@]}" "$@"
```

Version stays pinned (that is the point of the pin); the home path no longer is; `PI_NODE_BIN`
gives an escape hatch. Applied to all six wrappers, verified by `grep -rn "/home/pmpmt"` →
no match.

### Reporting why the pre-start pull was skipped

The launcher ran `git pull --ff-only --quiet >/dev/null 2>&1` and printed a fixed
"dirty, diverged or offline" line. During verification it fired while `git pull` exited 0 in
0.9 s — most likely an `index.lock` collision with a concurrent git command — and there was no
way to tell. Now the reason travels:

```bash
if _pull_err=$(timeout 15 git -C "$HOME/.pi" pull --ff-only --quiet 2>&1); then
  :
else
  _reason=$(printf '%s' "${_pull_err:-timed out or git unavailable}" | tr '\n' ' ' | cut -c1-160)
  echo "pi-cos: workspace pull skipped — $_reason (starting with local state)" >&2
fi
```

### Secrets on the VPS: derive locally, never cross SSH

The VPS's own `~/.pi/agent/.env` already carried `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`,
`OPENAI_API_KEY`, `GOG_ACCOUNT` and `GOG_KEYRING_PASSWORD`. The four new per-agent `.env`
files were therefore generated **on the VPS** from those values, mode 600, so no credential
travelled over the wire and there is still exactly one source of truth per machine.

`TELEGRAM_BOT_TOKEN` was deliberately excluded from the CoS replica. Its old
`telegram.json` was left behind (byte-identical token check: `sha256` prefix `b366b57864a0`
on both `~/.pi/agent/.env` and the replica `.env`), because one token means one polling owner.

---

## Implementation

### Phase 1 — Laptop launcher fixes

- `~/.local/bin/pi` rewritten as a 20-line delegate (option A above), with a header recording
  why it is no longer a wrapper and how to reach the old bare home.
- All six wrappers: hardcoded node path → `NODE_BIN`.
- `pi-cos-orchestrator-agent`: the pull-warning fix above (75 lines total).

### Phase 2 — Laptop configuration fixes

- New `agent.json` in the CoS home (52 lines): `name`, `launcher`, `defaultPrompt: /usage`,
  six tools, and `/usage`, `/ask`, `/sync`, `/cron`. Safe to add because
  `scripts/fetch-publications.ts` skips its own home —
  `npm run fetch:publications -- --check` → `[ok] unchanged APPEND_SYSTEM.md (siblings:
  image-describer, sm-google-workspace, web-master)`.
- `agent-gog-workspace-agents/sm-google-workspace/sm-google-workspace/default-model.json`:
  `"effort": "high"` → `"thinking": "high"`, `updatedAt` refreshed.
- `agent-web-master/web-master/settings.json`: `enabledModels` += `gemini-3.6-flash`, so the
  saved default sits inside its own picker scope.
- `~/AGENTS.md`: both "portable rules live in `~/.pi/agent/…`" pointers rewritten to the CoS
  home, with a note that `~/.pi/agent/` is harness state only now.
- Deliberately **not** changed: `sm-google-workspace/agent.json` `defaultPrompt: "/inbox-new"`,
  because the manifest convention (enforced by `fetch-publications.ts`) is "defaultPrompt is
  always a slash command", and the plain-language default is already carried by its `call`
  and `purpose` fields.

### Phase 3 — Sync the repository

```console
$ git add -A && git commit -m "Add CoS agent manifest, enable gemini-3.6-flash for web-master"
58dbd96 …
$ git -c credential.helper='!~/.local/bin/gh auth git-credential' push origin main
f2a5e88..58dbd96  main -> main
```

The laptop's remote is HTTPS with no credential helper configured; `gh` is logged in, so the
push used `gh auth git-credential` for that one invocation rather than changing the remote to
SSH (which is what the VPS uses).

### Phase 4 — VPS: pull, migrate, populate

```console
$ ssh pmpmt@100.85.79.17 'cd ~/.pi && git pull --ff-only'   # d4fc979 -> 58dbd96, fast-forward
$ ls -d ~/.pi/agent-*                                        # renamed homes now exist
```

The rename commits move **tracked** files; ignored files stay in the retired directories. Only
`~/.pi/cos-orchestrator-agent/` survived (`web-master/`, `gog-workspace-agents/` and
`image-describer/` held nothing but tracked files), so its machine-local state was copied into
the new home with no clobbering:

```bash
for e in auth.json bin logs npm sessions skills tmp; do
  rsync -a --ignore-existing --exclude "tmp/pi-telegram" "$OLD/$e" "$NEW/"
done
cp -p ~/.pi/cos-orchestrator-agent/.env ~/.pi/agent-cos-orchestrator-agent/.env
```

`telegram.json` and `tmp/pi-telegram/` were excluded on purpose (shared token). The retired
directory was then moved **out of the repo** — `~/retired-pi-cos-orchestrator-agent-20261102/`
— because `~/.pi` is a git checkout and anything left inside is candidate auto-sync material.

Per-agent `.env` generation, all 600, values read from the VPS's own `~/.pi/agent/.env`:

| File | Keys |
|---|---|
| `~/.pi/agent-cos-orchestrator-agent/.env` | DeepSeek, Gemini, OpenAI, Telegram (appended `OPENAI_API_KEY` to the migrated file) |
| `~/.pi/agent-web-master/.env` | DeepSeek, Gemini, OpenAI |
| `~/.pi/agent-gog-workspace-agents/sm-google-workspace/.env` | DeepSeek, Gemini, OpenAI, `GOG_ACCOUNT`, `GOG_KEYRING_PASSWORD` |
| `~/.pi/agent-image-describer/.env` | DeepSeek, Gemini, OpenAI |

Launchers were installed by streaming each file over SSH and `mv`-ing into place, then compared
by md5: `pi-cos-orchestrator-agent 3cf01885`, `pi-web-master 4b6b9d04`,
`pi-sm-google-workspace b37a020e`, `pi-image-describer f76f6c8a` — all `SAME` as the laptop.
VPS `pi` (818 bytes, its own wrapper) and `pi-explore-discover-pi` were left untouched.

### Phase 5 — Two defects found by the verification pass

1. **The VPS's `GEMINI_API_KEY` is dead.** The `AQ.Ab8…` key (53 chars) in
   `~/.pi/agent/.env` returns `401 … The bound service account is deleted or disabled`; the
   replica's `AIza…` key (39 chars) answers. My first generation pass copied the dead key into
   three `.env` files; all three were rewritten from a live-call-verified source:

   ```console
   --- AQ. key (agent/.env):      401 UNAUTHENTICATED, ACCOUNT_STATE_INVALID
   --- AIza key (cos .env):       ok
   ```

   `~/.pi/agent/.env` itself was **not** modified — it belongs to the VPS's own identity, and
   the user is replacing that key separately.

2. **`pi-image-describer` could not load on the VPS**: `Cannot find module 'sharp'`
   (its extension imports `src/convert.ts`, which imports `sharp`; `node_modules` is gitignored
   and absent on a fresh checkout). Fixed with `npm install --omit=dev` in that home
   (`exifr`, `sharp`; sharp's install script is skipped by npm's `allowScripts` policy but the
   prebuilt binary works).

### Phase 6 — Cleaning a junk commit produced by the VPS auto-sync

Launching the replica on the VPS let `extensions/auto-sync.ts` commit and push
`2a628c2 [pi:neopmpmtj] session work`, which contained three files: the VPS's own
`agent/agents/explore.md` (legitimate) plus two pre-rename leftovers —
`cos-orchestrator-agent/cos-orchestrator-agent/npm/package.json` and the
`skills/yt-download` gitlink. Cause: the rename commits re-pointed `.gitignore` at
`agent-*`/ paths, so the retired directory stopped being ignored. Removed from the repo
(`87ffcef`) while keeping `agent/agents/explore.md`, pushed, pulled on the VPS, and the
retired directory moved outside `~/.pi` so it cannot recur. Both machines ended at `87ffcef`.

---

## Verification

| Check | Result |
|---|---|
| `bash -n` on all six wrappers | clean |
| `--version` through each wrapper, laptop | `1.4.0` ×6 |
| `--version` through each wrapper, VPS | `1.4.0` ×5 (`pi`, cos, web-master, sm, image-describer) |
| `grep -rn "/home/pmpmt"` in launchers | no match |
| `pi auth print-api-key --provider openai`, laptop | exit 0, 164 chars |
| live `gpt-6.1-sol` call, scratch home | `ok` |
| live `/ask` via cos, web-master, sm on the VPS | `ok`, `ok`, `ok` |
| `pi-image-describer -p "/describe-images --dir <empty>"`, VPS | run line + `Saved logs/descriptions/…` |
| `npm run fetch:publications -- --check` | `[ok] unchanged` (siblings unchanged, CoS self-excluded) |
| `pi` resolution, login shell | `~/.local/bin/pi` (delegate) |
| stub `git` that fails during pre-start pull | `pi-cos: workspace pull skipped — fatal: … Failed to connect (starting with local state)` |
| md5 launcher comparison laptop ↔ VPS | 4/4 `SAME` |
| `git log -1` both machines | `87ffcef` |
| fake-key experiments left behind | none (`/tmp` scratch homes removed) |

---

## Files Created/Modified

| File | Lines | Purpose |
|---|---|---|
| `~/.local/bin/pi` | 20 | Single entry point; delegates to `pi-cos-orchestrator-agent` |
| `~/.local/bin/pi-cos-orchestrator-agent` | 75 | `NODE_BIN` pin; pull failure now names its reason |
| `~/.local/bin/pi-web-master` | 55 | `NODE_BIN` pin (still the `effort` model-file variant, `--no-builtin-tools`) |
| `~/.local/bin/pi-sm-google-workspace` | 54 | `NODE_BIN` pin |
| `~/.local/bin/pi-image-describer` | 17 | `NODE_BIN` pin |
| `~/.local/bin/pi-explore-discover-pi` | 17 | `NODE_BIN` pin (laptop only; not deployed) |
| `agent-cos-…/cos-orchestrator-agent/agent.json` | 52 | New manifest: launcher, tools, `/usage` `/ask` `/sync` `/cron` |
| `agent-gog-…/sm-google-workspace/default-model.json` | 6 | `effort` → `thinking` (laptop only; gitignored) |
| `agent-web-master/web-master/settings.json` | 28 | `enabledModels` += `gemini-3.6-flash` |
| `agent-cos-…/docs/INBOX.md` | 45 | Closed the `gpt-6.1-sol` item; opened VPS Gemini-key and Telegram-ownership items |
| `~/AGENTS.md` | 74 | Portable-rules pointers moved to the CoS home |
| VPS `~/.pi/{agent-cos-…,agent-web-master,agent-gog-…/sm-google-workspace,agent-image-describer}/.env` | 3–5 each | Generated on the VPS from its own keys, mode 600 |
| VPS `~/.local/bin/{pi-cos-orchestrator-agent,…}` | as above | Four launchers installed, md5-identical to the laptop |
| VPS `~/.pi/agent-image-describer/image-describer/node_modules/` | 6 entries | `npm install --omit=dev` (exifr, sharp) |
| VPS `~/retired-pi-cos-orchestrator-agent-20261102/` | — | Pre-rename leftovers, moved out of the repo |

**Commits:** `58dbd96` (manifest + `enabledModels`), `87ffcef` (drop pre-rename leftovers);
the VPS also pushed `2a628c2` from auto-sync, which `87ffcef` corrects.

---

## Limitations & Future Work

Tracked in `agent-cos-…/docs/INBOX.md`:

1. **VPS `~/.pi/agent/.env` has a dead Gemini key** (`AQ.Ab8…` → 401, service account deleted
   or disabled). The four sibling `.env` files use the working `AIza…` key instead. User is
   replacing the dead key separately.
2. **Telegram ownership on the VPS is undecided.** The CoS replica has no `telegram.json`
   (identical token, one polling owner); the retired copy is at
   `~/retired-pi-cos-orchestrator-agent-20261102/`. Adding it back without a separate bot
   would make the replica fight `~/.pi/agent`'s bridge.
3. The retired directory is still on disk, outside `~/.pi`, as a safety copy. Delete it once
   the migration is trusted.
4. `.gitignore` only knows the `agent-*`/ paths now. Any machine that still has a
   `cos-orchestrator-agent/` tree inside `~/.pi` will get its contents auto-committed; the
   rename deliberately did not add retired paths.
5. `agent-web-master/.env` on the VPS has no `PERPLEXITY_API_KEY` (that box never had one), so
   whatever web-search path needs it is unavailable there.
6. `~/.local/bin/pi` on the VPS remains its own wrapper, hardcoding `/home/pmpmt` and pointing
   its header at the pre-rename path. Left alone by agreement — the VPS `pi` still starts
   `~/.pi/agent`, not the CoS replica.
7. Non-login SSH does not put `~/.local/bin` on `PATH` on the VPS; launchers must be called by
   absolute path (or `export PATH="$HOME/.local/bin:$PATH"` first).
