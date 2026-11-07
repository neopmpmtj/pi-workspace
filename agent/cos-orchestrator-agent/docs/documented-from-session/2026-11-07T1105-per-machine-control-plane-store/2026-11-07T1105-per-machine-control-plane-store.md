# Per-machine control-plane store, seeding and crash/hang hardening — Setup & Implementation Report

**Date:** 2026-11-07
**System:** Ubuntu 24.04.5 LTS, Pi v1.5.0, Node v24.21.0 (`~/.nvm/versions/node/v24.21.0`)
**Location:** `~/.pi/` (the `pi-workspace` repo) — `control/{store,cli,server}.ts`, `control/public/app.js`, `control/*.test.ts`, `.gitignore`, `{config,input-phrase-config,prompt-build-config}.sample.json`; runbook `~/.pi/agent/cos-orchestrator-agent/docs/runbooks/pi-config-terminal-toggles.md`; remote host `neopmpmtj` (VPS) at `~/.pi`

---

## Problem

The terminal control plane stores its state in three files at the repo root, and all three were
**tracked by git**: `~/.pi/config.json`, `~/.pi/input-phrase-config.json`,
`~/.pi/prompt-build-config.json`. They record *host state* — which mode is on, which input phrase,
every gate value — so any change on one machine dirtied the repo and conflicted with the other.
That conflict was live, not theoretical: `prompt-build-config.json` was already `M` in
`git status` when the request arrived.

Three goals came out of one request:

1. Make the three files **per-machine** without losing their schema: track `*.sample.json`
   copies instead, and ignore the real files.
2. Keep both hosts correct across the transition — including the fact that *pulling* the commit
   that untracks a file **deletes it from the working tree** on the other host.
3. Harden the readers so a broken or hung file cannot take the CLI down: if a store file (or an
   agent's `settings.json`) is missing or malformed, degrade with a note instead of an error, and
   never hang on a file system that stops answering.

---

## Investigation / Root Cause

No external research was needed; every finding came from the repo, the two hosts and Node itself.

| # | Finding | Cause / consequence |
|---|---|---|
| 1 | `config.json`, `input-phrase-config.json`, `prompt-build-config.json` are tracked; no ignore rule matched them | the conflict the user reported |
| 2 | `git status` already showed `M prompt-build-config.json` | switching mode (2-Development) dirties the repo |
| 3 | `~/.pi/config.json` is tracked too and holds the same kind of state (`modeSwitch`, `calendarNode`, thresholds) | same problem, not named in the request |
| 4 | Missing-file behaviour differed between consumers | hooks (`src/global-config.ts` → `readEnabledSection`) return null → hook simply off; `pi-config` (`control/store.ts` → `readObject`) threw `SettingsError: Cannot read …` and exited 1 |
| 5 | The VPS was **9 commits behind**, working tree clean, and had **no** `input-phrase-config.json` / `prompt-build-config.json` at all; its `config.json` predated `modeSwitch` | both hooks are off there, and the CLI could not even read those sections |
| 6 | The VPS had no `~/.local/bin/pi-config` launcher | the launcher is a hand-installed script in `~/.local/bin`, **not** in the repo, so a fresh host silently lacks the CLI |
| 7 | A pull that removes a file from the index deletes it from the working tree | the VPS's `config.json` disappeared on `git pull` (observed), which is why the transition needs backup → pull → restore |
| 8 | `process.exit()` and `process.reallyExit()` **hang** while a file-system request is blocked in libuv's threadpool | minimal repro (`readFile` on a FIFO with no writer, then `setTimeout(() => process.exit(1), 500)`) printed the message and then stayed alive until an outside `timeout` killed it, exit 124. Only a **signal** ends such a process (`SIGKILL` → 137) |

Finding 8 is the one that shaped the design: a per-operation deadline alone cannot rescue a read
blocked inside the kernel (dead NFS/sshfs mount, FIFO, wedged device), because the pending request
is drained during shutdown. The command needs an escape that does not go through Node's shutdown.

---

## Architecture / Design Decisions

### Where the samples live, and how the ignore rules are written

| Option | Verdict |
|---|---|
| `~/.pi/<name>.sample.json`, root-anchored ignore rules | **chosen** — restore is `cp X.sample.json X`, the pair sits together, and anchoring (`/config.json`) leaves any nested `config.json` in sub-agents tracked |
| unanchored `config.json` rule | rejected: matches at every depth; only the root file is the store |
| `control/samples/` directory | rejected: the copy command stops being an obvious neighbour of its target |

### Missing file: seed, degrade, or fail

Three shapes were considered for the CLI's `readObject`:

| Option | Behaviour | Verdict |
|---|---|---|
| A — fail (status quo) | `SettingsError: Cannot read X`, exit 1; hooks meanwhile run with the file absent (off) | rejected: a fresh host has dead hooks *and* a dead CLI, discovered only when someone reaches for it |
| B — read-through in memory | CLI silently uses the sample; hooks still off | rejected: the CLI reports "Development on" while the agent actually runs with no mode — read and runtime disagree |
| C — **seed on first read** | copy `<name>.sample.json` → `<name>` (`flag: "wx"`, exclusive), then read it; one `[note]` line | **chosen**: no window in which the CLI and the hooks disagree, and a new host self-heals |

The copy is exclusive so a file created meanwhile wins; the sample itself is never written. Files
with **no** sample (`settings.json`, `default-model.json`) still fail with `Cannot read …` — those
are tracked, so a missing one means a broken checkout and deserves to be loud.

### One bad file must not hide the rest

`readControlPlane` now reads the three store files **and each agent** through a small
`attempt()` wrapper:

- a failure becomes `{ file, message }` in `plane.problems` and an empty section
  (`gates: []`, `inputPhrase: null`, `promptBuild: null`, or an agent view with
  `readable: false, error`);
- `list` prints everything readable and exits **0**, with the notes on stderr;
- `get`/`set` on a path inside a broken file fail with
  `[FAIL] input-phrase-config.json: <reason>` instead of the misleading "No gate or section named …";
- **writes stay strict** — they need the file they are about to edit.

Reporting was moved out of the store: `readControlPlane` returns `problems[]` and `seeded[]`, and
the caller decides (CLI: `io.err`; server: deduplicated `console.error`). This keeps `--json` output
clean on stdout and makes the notes assertable in tests.

### Two deadlines, and why the second one kills the process

| Deadline | Default | Scope | Failure mode |
|---|---|---|---|
| `PI_CONFIG_TIMEOUT_MS` | 5000 | one `readFile`/`writeFile` (via `AbortSignal.timeout`) | `<file>: no answer within N ms — the file system is slow or hung.` |
| `PI_CONFIG_WATCHDOG_MS` | 15000 | the whole command | `[FAIL] no answer within N ms … (exit 137)`, then `SIGKILL` to self |

The watchdog exists because finding 8 makes `process.exit()` unusable in exactly the case it is
needed. **Exit 137 is the designed outcome**, not a crash.

### Writes are atomic or they are nothing

`writeObject` writes to `<file>.<pid>.<ms>.tmp`, renames, and removes the temp file on any failure.
A kill (including the watchdog's) therefore cannot truncate the real file. Temp names are unique so
two concurrent writers cannot collide on the temp.

---

## Implementation

### Phase 1 — samples, untracking, ignore rules (`2410649`)

```bash
cd ~/.pi
cp -p config.json config.sample.json
cp -p input-phrase-config.json input-phrase-config.sample.json
cp -p prompt-build-config.json prompt-build-config.sample.json
git rm --cached config.json input-phrase-config.json prompt-build-config.json
```

`.gitignore` (+16 lines, 143 total), with the seed command in the comment so the file documents
itself:

```gitignore
# ── Control-plane store (per-machine state, never synced) ─────────
# ... Seed or reset a machine with:
#   cd ~/.pi && cp config.sample.json config.json \
#     && cp input-phrase-config.sample.json input-phrase-config.json \
#     && cp prompt-build-config.sample.json prompt-build-config.json
# Anchored to the repo root: nested config.json files stay tracked.
/config.json
/input-phrase-config.json
/prompt-build-config.json
```

Verified: `git check-ignore -v` matches all three; the working copies stayed on disk untouched.

### Phase 2 — runbook section (`5281ba0`)

`docs/runbooks/pi-config-terminal-toggles.md` gained "The three store files are per-machine, not
tracked (2026-11-07)" with the sample names, the seed command, and the backup-before-pull warning.

### Phase 3 — the transition on the VPS

1. Back up the three files to `/tmp/pi-config-backup-*` **before** pulling.
2. `git pull --ff-only` → 9 commits, and the three store files were removed from the working tree,
   as predicted.
3. Restore `config.json` from the backup, then seed all three from the samples (the VPS had no
   phrase/prompt-build file, and its `config.json` was older than `modeSwitch`).
4. Install the missing launcher (it is not in the repo):

```bash
cat > ~/.local/bin/pi-config   # copied from the laptop's ~/.local/bin/pi-config
chmod +x ~/.local/bin/pi-config
```

5. Prove the point: `pi-config use promptBuild.3-Work`, then back to `2-Development` — `git status`
   clean both times. `pi-config list` prints no notes on either host.

### Phase 4 — seeding in the store (`261c386`)

`control/store.ts`:

- `readObject(file, note?)` now distinguishes error classes: a `SettingsError` (timeout, directory,
  permission) is rethrown as-is; `ENOENT` attempts `seedFromSample`; anything else stays
  `Cannot read X.`
- `seedFromSample(file, note?)` reads the sample, copies it with `flag: "wx"`, and reports
  `<name> was missing — seeded from <name>.sample.json` through the callback.
- `samplePath()` derives the sample from the name: `config.json` → `config.sample.json`.

### Phase 5 — degradation, deadlines and atomic writes (`940738e`)

Store (`control/store.ts`, 726 lines):

```text
96   readControlPlane          per-section + per-agent attempt(), collects problems[] and seeded[]
138  planeProblem              lookup by file for the CLI
153  attempt                   failure → { file, message }; never prints
168  unreadableAgent           readable:false, error, empty fields
595  readObject                seed on ENOENT, rethrow SettingsError
627  seedFromSample            exclusive copy, note callback
658  timeoutMs                 PI_CONFIG_TIMEOUT_MS, default 5000
664  readText / 673 writeText  AbortSignal.timeout on every operation
682  describeFsError           EISDIR/EPERM/EROFS/ENOSPC/EDQUOT/abort → sentences
702  writeObject               unique tmp + rename, tmp removed on failure
718  exists                    read-based, so it inherits the deadline
```

`ControlPlane` gained `problems: PlaneProblem[]` and `seeded: string[]`;
`inputPhrase`/`promptBuild` became nullable; `AgentSettingsView` gained `readable`/`error`.

CLI (`control/cli.ts`, 646 lines): `assertReadable()`, `unavailable()`, `inputPhraseOf()`,
`promptBuildOf()` (§483–507), `formatPlane` prints `(unreadable: …)` rows and a `skipped files`
block, and `watchdog()` (§620) guards the entry point:

```ts
const timer = watchdog();
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`[FAIL] ${error instanceof Error ? error.message : "Command failed."}\n`);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
```

Server (`control/server.ts`, 135 lines): `/api/settings` logs each distinct note once
(`logNotes`, §91) so a polled page cannot spam the log.

Page (`control/public/app.js`, 370 lines): problems are printed at the top, a null section renders
`unreadableCard()` (§107) with no form, and an unreadable agent renders a read-only card (§249).

---

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` (agent home: `tsc --noEmit` + `tsc -p ../../control/tsconfig.json`) | clean |
| `npm run test:dashboard` on the laptop | **25 pass / 0 fail** (was 12 before the session) |
| Same suite on the VPS | **25 pass / 0 fail**, including the FIFO watchdog test |
| Fresh root: three samples, nothing else | three `[note] … seeded from …` lines, then a full table; files created on disk; second run silent |
| Real tree `pi-config list` | no notes, all five agents readable |
| Live dashboard degradation | `settings.json` of keep temporarily removed → `/api/settings` returned `problems: [{file: "agent.keep", …}]` and `readable: false`; restored, `git status` clean, problems `[]` again, one log line only |
| VPS mode flips after untracking | `git status` clean before and after `use promptBuild.3-Work` → `2-Development` |
| Blocking read (FIFO, no writer) | `[FAIL] no answer within 800 ms … (exit 137)` in 0.9 s instead of hanging; asserted by test |

Test inventory added (13 new):

| Suite | Cases |
|---|---|
| a store file that is missing (per-machine files, seeded from the sample) | seeds and reads; seeds then applies a write; an existing file beats its sample; no sample → still `SettingsError` |
| a file that cannot be read is skipped, never fatal | missing agent `settings.json`; malformed `config.json`; a directory where a file belongs |
| the write path | directory left clean, file whole |
| pi-config on a damaged tree | `list` marks and reports; `get`/`set` name the file; unreadable agent refused; bare tree seeds and lists |
| pi-config against a file system that stops answering | FIFO with no writer → watchdog ends the process (exit 137) in <1 s |

---

## Files Created/Modified

| File | Lines | Purpose |
|---|---|---|
| `~/.pi/config.sample.json` | 35 | tracked schema for the gates store (571 bytes) |
| `~/.pi/input-phrase-config.sample.json` | 16 | tracked schema for the input phrase (316 bytes) |
| `~/.pi/prompt-build-config.sample.json` | 25 | tracked schema for the modes (534 bytes) |
| `~/.pi/.gitignore` | 143 | new root-anchored block + self-documenting seed command |
| `~/.pi/control/store.ts` | 726 | seeding, per-section degradation, deadlines, atomic writes |
| `~/.pi/control/cli.ts` | 646 | `problems`/`seeded` reporting, null-safe sections, watchdog, `[FAIL]` guard |
| `~/.pi/control/server.ts` | 135 | deduplicated note logging on `/api/settings` |
| `~/.pi/control/public/app.js` | 370 | problems banner, unreadable section/agent cards |
| `~/.pi/control/store.test.ts` | 270 | 8 cases added across three suites |
| `~/.pi/control/cli.test.ts` | 341 | 5 cases added incl. the FIFO watchdog |
| `…/docs/runbooks/pi-config-terminal-toggles.md` | 231 | per-machine section + "When something is broken" |
| `~/.local/bin/pi-config` (VPS) | 21 | the launcher the VPS never had |
| `…/documented-from-session/2026-11-07T1105-per-machine-control-plane-store/2026-11-07T1105-per-machine-control-plane-store.md` | 282 | this report |

**Commits:** `2410649` untrack + samples + ignore rules · `5281ba0` runbook · `261c386` seeding ·
`940738e` degradation, deadlines, watchdog. All pushed, both hosts at `940738e`, `git status`
clean on both.

---

## Limitations & Future Work

1. **Exit 137 is not a crash.** A kernel-blocked read cannot be aborted from JavaScript; the
   watchdog can only signal the process. Callers must treat 137 as "file system hung", not "invalid
   config" — the `[FAIL]` line says so.
2. The launcher `~/.local/bin/pi-config` **is not tracked**. It was copied to the VPS by hand; a
   future host needs the same step, or the launcher should be moved into `scripts/` and installed.
3. Seeding notes surface through `readControlPlane` (`list`, `get`). A `set` that seeds the file it
   is about to write succeeds silently — the value it wrote is the confirmation.
4. `list` exits 0 even with problems (by design); scripts that need strictness should check for
   `problems` in `--json` output or run `get` on the path they care about.
5. The transition was a one-time hazard: any *future* commit that untracks a live file will again
   delete it on the other host during `pull`. Back up, pull, restore.
6. Seeding the VPS from the laptop's samples also **enabled `modeSwitch`** there and set
   `2-Development` on; that host previously ran without the mode hook. It is the intended parity,
   and reversible with `pi-config use promptBuild.<mode>` / `pi-config set modeSwitch.enabled off`.
7. No project dashboard runs on the VPS at `:8786`; the server-side changes there are exercised
   only by unit tests.
