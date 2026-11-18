# sm-google-workspace Sibling Agent — Setup & Implementation Report

**Date:** 2026-11-01
**System:** Ubuntu 24.04.5 LTS, Pi v1.4.0, Node v24.21.0, `gog` v0.34.0
**Location:** `~/pi-agents-experts-grouped/gog-workspace-agents/sm-google-workspace/` (repo root) and `…/sm-google-workspace/sm-google-workspace/` (Pi agent home); COS side in `~/pi-agents-experts-grouped/cos-orchestrator-agent/`

---

## Problem

A fourth sibling agent, `sm-google-workspace`, existed on disk with source, ledger and
extension code, a launcher (`pi-sm-google-workspace`) and a `.env` holding only two provider
keys. It had nothing that made it addressable from the COS:

- no `agent.json` (no manifest: name, launcher, default prompt, purpose, contract),
- no `docs/CALLING.md` (no calling contract, no published command list),
- no build entry point (`package.json`, `scripts/publish.ts`, `node_modules`), so
  `npm run publish:agent` did not exist and could not have run.

Two further goals came out of the same conversation, once the first was understood:

1. **A token-free fast path** for questions asked constantly — "list my Drive root", "what
   mail is new" — instead of paying a chat turn for each.
2. **A rename** of the group folder `gog-worksapce-agents` → `gog-workspace-agents`, done
   without losing git history, ledger accounting, or the ability to launch the agent.

The COS also had to learn about the new sibling: its roster table is generated from sibling
manifests, and the generator only understood one directory depth.

---

## Investigation / Root Cause

No external research was needed; the diagnosis came from reading the existing siblings
(`web-master`, `image-describer`) and running the components. Findings, in the order they
surfaced:

| # | Symptom | Cause |
|---|---|---|
| 1 | `npm run publish:agent` impossible | no `package.json`, no `scripts/publish.ts` in the home |
| 2 | `ERR_MODULE_NOT_FOUND: Cannot find package '@earendil-works/pi-ai' imported from src/ask.ts` | no `node_modules`; the publisher imports the extension, and `ask.ts` value-imports `pi-ai` |
| 3 | `gog auth list` → `no TTY available for keyring file backend password prompt` | `GOG_KEYRING_PASSWORD` absent from this repo's `.env`; a non-interactive shell cannot unlock the `file` keyring |
| 4 | `gog` would also fail with `missing --account` | `GOG_ACCOUNT` absent from `.env` |
| 5 | `Warning: No models match pattern "gpt-6.1-sol"` on every launch | `settings.json` enabled a model whose provider has no key in `.env` |
| 6 | `npm test` → 2 failures | `test/dashboard.test.ts` and `test/fetch-publications.test.ts` are template leftovers importing `dashboard/server.ts` and `scripts/fetch-publications.ts`, neither of which this agent has |
| 7 | sibling row missing from the COS roster | `scripts/fetch-publications.ts` scanned `<group>/<home>` only, while this agent is `<group>/<repo>/<home>` |
| 8 | after rename: git refused to see the submodule | `core.worktree` and the submodule's `.git` file still named the old path |

Two facts had to be established before writing anything into the manifest:

- **The passphrase was in the wrong file.** `GOG_KEYRING_PASSWORD` had been added to
  `~/.pi/agent/.env` — the *main* agent's credentials file, which the COS is forbidden to
  read. The same variable exists in `~/archived-pi-agents-experts/gog-worksapce-agents/sm-google-workspace/.env`,
  an archived copy of *this same agent*, and that is where the value was taken from.
- **`/ask` cannot reach Google.** Reading `extensions/chat/index.ts` confirmed `/ask` calls
  `runAsk()` directly — registry, one request, no chat turn, therefore no tools. The `gog`
  CLI is reachable only from a chat turn, where the agent has `bash`.

An append accident happened during the credentials fix and was repaired: the target `.env`
had no trailing newline, so `cat >> .env` glued `GEMINI_API_KEY`'s tail to the new
`GOG_KEYRING_PASSWORD=` line. The file was rebuilt by parsing both copies, the GEMINI value
was reconstructed (`37 chars + "CM"` = the archived 39-char value, verified equal), and the
bogus `CMGOG_KEYRING_PASSWORD` key was dropped.

---

## Architecture / Design Decisions

### `/ask` versus a chat turn

The two call shapes are not interchangeable, and the choice determines the manifest:

| | `/ask <question>` | plain-language task |
|---|---|---|
| Chat turn | none | yes |
| Tools available | none | `read`, `bash`, `edit`, `write`, `grep`, `find` |
| Can run `gog` | no | yes |
| Cost | exactly one request | several round trips, tool output in context |
| Right for | general knowledge, drafting, text work | anything about the account |

**Decision:** `defaultPrompt` is `/inbox-new` (a canned command, so a bare call is still
cheap and useful), `call` is `<task in plain language>`, and `/ask` is documented as text-only.
This is an explicit exception to the COS rule "always send the sibling's slash command", and
the roster prose now says so.

### Fast path versus a documented cheatsheet

| Option | Latency | Tokens | Flexibility | Code |
|---|---|---|---|---|
| Chat turn with the exact `gog` command in `AGENTS.md` | seconds | yes | full phrasing | none |
| Canned slash command running one fixed `gog` command | ~1 s | none | one question, fixed columns | new module + registration |

**Decision:** both, with the canned commands carrying the frequent questions. Measured on
this machine: `gog auth list` 82 ms, `gog drive ls` 0.55 s, `gog gmail search` 0.99 s,
`/gdrive-root` end-to-end through the launcher 1.1 s.

### Rename strategy

| Concern | Approach | Why |
|---|---|---|
| Working tree | `mv` on one filesystem | no copy, no window where both paths exist |
| Submodule git dir | move `.git/modules/<name>`, rewrite the `.git` file, repoint `core.worktree` | a moved submodule whose `core.worktree` is stale makes every git command in it fail |
| `.gitmodules` + parent index | corrected section name/path, re-registered with `init` + `sync`, old gitlink removed | `git rm --cached` is refused until `.gitmodules` is staged — order matters |
| Hardcoded paths | `ledger/env.ts` fallback, `src/ask.ts` message, contract, docs, launcher | the fallback is what keeps the agent working when the launcher is bypassed |
| Ledger | rewrite `session_files`, `runs`, `calls` paths in place | new paths would be re-read from byte 0; `INSERT OR IGNORE` on `call_id` prevents double counting, but the rewrite avoids the re-read entirely |
| Session logs | left with the old spelling | they record the cwd that produced them — history, not configuration |

---

## Implementation

### Phase 1 — Build prerequisites

```bash
cp web-master/web-master/scripts/publish.ts sm-google-workspace/scripts/   # byte-identical across siblings
# package.json: type=module, devDeps pinned 1.4.0 (pi-ai, pi-coding-agent), @types/node, typescript
npm install --no-audit --no-fund                                          # 122 packages
```

`package.json` scripts: `test`, `typecheck`, `publish:agent`. The publisher imports every
extension named in `settings.json` with a cache-busting query, stubs `registerCommand` and
`registerTool`, and rewrites the `commands`/`tools` keys of `agent.json` plus the
`BEGIN/END GENERATED: commands` block of `docs/CALLING.md`. Code is the source of truth.

### Phase 2 — Manifest and contract

`agent.json` carries the hand-written half only:

```json
{
  "name": "sm-google-workspace",
  "launcher": "pi-sm-google-workspace",
  "defaultPrompt": "/inbox-new",
  "call": "<task in plain language> (e.g. List all folders in the root of my Google Drive)",
  "purpose": "…runs `gog` itself from bash, so the default call is a plain-language task…",
  "account": "neopmpmtj@gmail.com",
  "contract": "~/…/sm-google-workspace/docs/CALLING.md",
  "tools": []
}
```

`docs/CALLING.md` is prose (default call, both call kinds, output shapes, `gog`
prerequisites, failure modes) followed by the generated block, which `publish:agent` fills.

### Phase 3 — The token-free fast path

New module `src/gog.ts` separates the pure part from the process part:

```ts
export function plan(command: CannedCommand, args: string): CannedPlan   // argv + row shaper
export async function runCanned(command, args, timeoutMs = 30_000): Promise<GogResult>
export function runGog(argv: string[], timeoutMs = 30_000): Promise<GogResult>
```

- `plan` rejects unknown arguments (`/gdrive-root takes no arguments.`, `--hours must be 1 to 720.`)
  and whitespace-collapses every cell so tab-separated rows stay one row per record.
- `runGog` spawns `gog` with `process.env` (the launcher filled it from `.env`), collects
  stdout/stderr, kills at 30 s, and turns a non-zero exit into one `[FAIL]`-able line.
- `extensions/chat/index.ts` registers both commands from the `CANNED` tuple, routes `--help`
  to `GOG_HELP`, and reuses the existing `showText()`/`fail()` paths — so print mode writes to
  fd 1, failures exit 1, and `HELP` exposes the new commands to the publisher.

Output shapes:

```text
# /gdrive-root        <name>\t<folder|file>\t<id>\t<modifiedTime>
# /inbox-new          <date>\t<from>\t<subject>\t<id>
```

### Phase 4 — Tests

`test/gog.test.ts` (9 tests) covers argument parsing, both argv shapes, row shaping, and that
every canned command has help text. The two orphan tests were deleted. Suite: 109 pass,
`tsc --noEmit` clean.

### Phase 5 — Publish

```console
$ npm run publish:agent
[ok] updated agent.json
[ok] updated docs/CALLING.md
$ npm run publish:agent -- --check
[ok] unchanged agent.json
[ok] unchanged docs/CALLING.md
```

Published commands: `/usage`, `/gdrive-root`, `/inbox-new`, `/ask`.

### Phase 6 — Teaching the COS about a deeper layout

`scripts/fetch-publications.ts` scanned two levels; this agent lives three deep. Added
`candidateHomes()`: for each group, a child with its own `agent.json` is a home, otherwise it
is treated as a repo root and its subdirectories are scanned. One new test asserts the row is
rendered for `<group>/<repo>/<home>`. Roster prose in `APPEND_SYSTEM.md` gained the second
exception, and the missing-manifest hint gained the second glob. 115 tests pass.

### Phase 7 — Rename `gog-worksapce-agents` → `gog-workspace-agents`

```text
mv gog-worksapce-agents gog-workspace-agents
mv .git/modules/gog-worksapce-agents .git/modules/gog-workspace-agents
printf 'gitdir: ../.git/modules/gog-workspace-agents\n' > gog-workspace-agents/.git
git config --file .git/modules/gog-workspace-agents/config core.worktree ../../../gog-workspace-agents
# .gitmodules: section name + path; url left until the GitHub repo was renamed
git add .gitmodules && git rm --cached -r gog-worksapce-agents
git add gog-workspace-agents && git submodule init/sync
```

Then the six files that spelled the path out (`ledger/env.ts`, `src/ask.ts`, `agent.json`,
`docs/CALLING.md`, `README.md`, `.env.example`) and the launcher's two variables; then the
ledger, in one transaction:

```sql
update session_files set path        = replace(path, '/gog-worksapce-agents/', '/gog-workspace-agents/');
update runs          set session_file = replace(session_file, …);
update calls         set session_file = replace(session_file, …);
-- 10 / 20 / 56 rows; every resulting path resolves
```

After the GitHub repository was renamed, `.gitmodules` `url`, the parent's `.git/config` and
the submodule's `origin` were repointed, and the missing commits were pushed — the remote
`main` had still been at `eec3c44`, the initial commit.

---

## Verification

| Check | Result |
|---|---|
| `/gdrive-root` | 20 rows, folders marked, 1.1 s, no tokens |
| `/inbox-new --hours 6` / `--hours 1` | 1 row / `nothing found` |
| `/inbox-new --days 3` | `[FAIL] Unknown argument --days…`, exit 1 |
| `/gdrive-root --hours 2` | `[FAIL] /gdrive-root takes no arguments.` |
| plain-language task | real Gmail counts, `gog` used, chat turn |
| `/usage`, `/usage --all` | cost lines; 56 calls across history before and after the rename (no duplication) |
| `env -u PI_CODING_AGENT_DIR` | `agentDir`, `repoRoot`, `sessionsRoot`, `ledgerPath`, rate card all resolve under the new name |
| sibling suite / typecheck / publish check | 109 pass, clean, unchanged |
| COS suite / typecheck / fetch check | 115 pass, clean, unchanged |
| `git submodule status` | four submodules clean, no `+`/`-` |
| fresh clone of the parent + `submodule update --init gog-workspace-agents` | checks out `af376b0`, with `agent.json` and `docs/CALLING.md` present |
| old GitHub URL | still redirects to the renamed repo |

---

## Files Created/Modified

| File | Lines | Purpose |
|---|---|---|
| `…/sm-google-workspace/agent.json` | 28 | Manifest; `commands` filled by publish |
| `…/sm-google-workspace/docs/CALLING.md` | 135 | Calling contract + generated command block |
| `…/sm-google-workspace/src/gog.ts` | 159 | Canned-command planner, spawner, row shaper |
| `…/sm-google-workspace/extensions/chat/index.ts` | 253 | Registers `/gdrive-root`, `/inbox-new`; `HELP` export |
| `…/sm-google-workspace/test/gog.test.ts` | 66 | 9 tests for the fast path |
| `…/sm-google-workspace/package.json` | 19 | Build entry point (`publish:agent`) |
| `…/sm-google-workspace/scripts/publish.ts` | 166 | Shared publisher, copied verbatim |
| `…/sm-google-workspace/settings.json` | 24 | `enabledModels` minus `gpt-6.1-sol` |
| `sm-google-workspace/.env.example` | 14 | Adds `GOG_ACCOUNT`, `GOG_KEYRING_PASSWORD` |
| `sm-google-workspace/README.md` | 124 | Fast path, two call kinds, layout |
| `sm-google-workspace/.env` | 4 | Four keys (gitignored, mode 600) |
| `sm-google-workspace/model-rates.json`, `…/default-model.json` | 23 / 6 | Rate card; standing model (gitignored) |
| `…/logs/ledger.sqlite` rows | 86 | Session/run/call paths rewritten in place |
| `cos-…/scripts/fetch-publications.ts` | 173 | `candidateHomes()`: two- and three-level layouts |
| `cos-…/test/fetch-publications.test.ts` | 116 | Test for the nested layout |
| `cos-…/APPEND_SYSTEM.md` | 28 | Regenerated roster + second exception in prose |
| `cos-…/AGENTS.md` | 35 | Points at `docs/INBOX.md` |
| `cos-…/docs/INBOX.md` | 32 | Agreed-but-undone work, with resolved items struck |
| `~/…/.local/bin/pi-sm-google-workspace` | 52 | `ENV_FILE` and `PI_CODING_AGENT_DIR` |
| Deleted: `test/dashboard.test.ts`, `test/fetch-publications.test.ts` | — | Imported code this agent does not have |

**Commits:** gog `344b404`, `af376b0`; cos `f556778`, `e28c8bc`, `ea60b9b`, `b65effb`,
`23fd2bb`; parent `04e4e7f`, `d9ebdbd`, `feed0bb`.

---

## Limitations & Future Work

Now tracked in `cos-…/docs/INBOX.md`:

1. Canned commands cover only two questions; today's calendar, recent documents, unread from
   one sender and Drive search by name are the obvious next four.
2. No `--limit N`; a busy inbox prints every row.
3. `gpt-6.1-sol` is disabled in the sibling's `settings.json` and still enabled in the COS's
   own, both for the same reason: no `OPENAI_API_KEY`.
4. Canned output is tab-separated, not summarised. Anything needing judgement stays a chat turn.
5. A fresh clone has no `.env` by design, so `gog` needs `GOG_ACCOUNT`, `GOG_KEYRING_PASSWORD`
   and an `gog auth add` on the new machine (`docs/new-google-account-deploy.md`).
6. Only the gog submodule was exercised in the clone test; restoring all four with
   `--recurse-submodules` on another machine is unverified.
