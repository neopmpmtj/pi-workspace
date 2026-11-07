# Terminal control plane and the mode switch above JEV — Setup & Implementation Report

**Date:** 2026-11-07
**System:** Ubuntu 24.04.5 LTS, Pi v1.5.0, Node v24.21.0 (`~/.nvm/versions/node/v24.21.0`), DeepSeek `deepseek-flash` + `deepseek-v4-pro`
**Location:** `~/.pi/control/` (project control plane), `~/.local/bin/pi-config` (launcher), `~/.pi/agent/cos-orchestrator-agent/{src,extensions,test,docs}/`, `~/.pi/{config,input-phrase-config,prompt-build-config}.json`, `~/.config/systemd/user/pi-keep-agent-dashboard.service`

---

## Problem

Today's commits (`639612c`, `ba27f16`, `4859238`, `470ae3c`) added three surfaces and a dashboard,
and left four gaps that this session closed:

1. **The new configuration had no terminal door.** The values in `~/.pi/config.json`,
   `~/.pi/agent-modes-config.json` and `~/.pi/prompt-build-config.json`, plus every agent's
   `settings.json` / `default-model.json`, could be edited only through
   `http://127.0.0.1:8786/settings`, its HTTP API (which needs the server running), or by hand.
   Hand-editing fails silently: `inputPhrase` on with two options prints a conflict in chat and
   appends nothing; `words: 0` turns the gate off without a word.
2. **The project module was named for one of its consumers.** `~/.pi/dashboard/` held the store,
   the agent process control, the roster and the CLI-to-be, of which only `server.ts` + `public/`
   is a dashboard. It also sat outside every `tsconfig.json`, so `npm run typecheck` never saw it
   (four strict `TS7053` errors had accumulated), and its tests had no npm script.
3. **Two live defects around the new roster.** `dashboard/agents.ts` gives `image-describer` port
   8788, while `pi-keep-agent-dashboard.service` pinned keep-agent to 8788 and was running; and a
   second, inert project-dashboard process held no port.
4. **The agent had no deterministic, optional layer above the JEV classifier.** "what mode are you
   on" and "change your mode to X" could only be answered by a full model turn after a ~250 ms
   classifier call. The goal: detect a mode request first, run the equivalent control-plane CLI
   command, and hand the model nothing but an acknowledgement — optimising for speed, and never
   reporting success when the CLI failed.

A fifth change came from the operator mid-way and redefined the feature: a **mode is not
`inputPhrase`**. `inputPhrase` (`normal`/`advanced`) appends a phrase to *every* input and stays a
per-turn feature. A **mode is the `promptBuild` option** — the session-level layer that contributes
one section to the system prompt — and its four numbered slots needed real names:
`option1..option4` → `1-Personal`, `2-Development`, `3-Work`, `4-Automatic`. The file
`agent-modes-config.json` was therefore misnamed; it holds only the per-turn input phrase.

---

## Investigation / Root Cause

### What already existed, and what each surface could not do

| Surface | Covered | Could not |
|---|---|---|
| Web `/settings` on :8786 | all gates, `inputPhrase`, `promptBuild`, agent settings | run without the server; be scripted from a shell |
| HTTP API (`PUT /api/settings/…`) | the same | run without the server |
| `control/store.ts` (`writeGate`, `writeInputPhrase`, `writePromptBuild`, `writeAgentSettings`) | validation before an atomic `writeFile` + `rename` | be reached from bash |
| Slash commands (`/cron`, `/ask`, `/usage`, `/reminders`, `/archive`, `/sync`) | their own domains | any config value |

### Defects confirmed during the sweep

| # | Symptom | Cause | Fix |
|---|---|---|---|
| 1 | starting image-describer from the project dashboard would collide | roster says 8788/8790; the keep-agent systemd unit said `DASHBOARD_PORT=8788` | unit + `.env` + `CALLING.md` + `agent.json` → 8790; roster republished |
| 2 | two project-dashboard servers, one silent | pid 271193 held no socket | killed; verified :8786 still answered |
| 3 | `npm run typecheck` never looked at the project module | not under the agent home's `include` | `control/tsconfig.json` + second `tsc -p` in the agent's `typecheck` |
| 4 | the roster grew a second `keep-agent` row | `agent-template-new-agent/template-new-agent/agent.json` is a copy of keep-agent's manifest | `"publish": false` skip in `scripts/fetch-publications.ts` + test |
| 5 | first write to `prompt-build-config.json` produced a 25-line diff | the file was committed one-line-per-option; the store re-serialises with 2-space indent | rewritten canonically once |

### The decisive discovery: extension order is not the settings array

The request was for the mode layer to be "the very first thing" the runtime handles. The
`extensions` array in `settings.json` was reordered to put it first. A real `pi -p` run in a copied
home then printed the JEV line **before** the mode line, so the ordering assumption was tested
directly:

```text
extensions listed in settings.json: zzz, aaa, mmm
/tmp/order-test/agent/ext/extensions readdir:  aaa mmm zzz
pi -p "hi" printed:                            LOAD aaa
                                               LOAD mmm
                                               LOAD zzz
```

`dist/core/package-manager.js` confirms it: `collectAutoExtensionEntries()` walks
`readdirSync(dir, { withFileTypes: true })` with no sort, while `loadExtensions` receives that
list. `docs/extensions.md` only promises that "handlers run in extension load order" — it never
says the settings array defines that order.

**Consequence:** a literal "first handler" cannot be guaranteed without patching Pi. The layer was
made structural instead — see the next section.

### Mode concept, corrected

| | `inputPhrase` | `promptBuild` |
|---|---|---|
| File | `input-phrase-config.json` (was `agent-modes-config.json`) | `prompt-build-config.json` |
| Scope | every input, per turn | one section of the system prompt, session-level |
| Options | `normal`, `advanced` | `1-Personal`, `2-Development`, `3-Work`, `4-Automatic` |
| Role in this session | explicitly **not** a mode; left alone | the mode the switch reads and changes |

---

## Architecture / Design Decisions

### One validator, two front doors

`~/.pi/control/cli.ts` imports `~/.pi/control/store.ts` rather than re-implementing validation or
talking to the server:

| Option | Validation parity | Needs a server | Extra code |
|---|---|---|---|
| Shell + `jq` edits | none — silently wrong values | no | low |
| `curl` against `/api/settings` | exact | **yes** | medium |
| **Thin CLI importing `store.ts`** | exact (same functions) | **no** | ~550 lines |
| Move `store.ts` into a shared library first | exact | no | refactor + two build paths |

Calling the same four functions is what makes divergence impossible: adding a config section means
one edit in `store.ts`, and both surfaces gain it. `pi-config` covers **72 values** today (16 gate
fields, 8 `inputPhrase`, 13 `promptBuild`, 35 agent settings).

### `use` exists because of the exactly-one-option invariant

`inputPhrase` and `promptBuild` refuse a write that leaves zero or two options on while the
section is enabled. Swapping the on option with two `set` calls therefore fails in the middle.
`pi-config use <section>.<option>` performs the swap in one write, and the error for the failing
`set` names the command to use instead.

### `dashboard/` → `control/`

The folder holds `store.ts` (the control plane itself), `cli.ts`, `agents.ts` (roster and ports),
`processes.ts` (agent dashboard lifecycle), `server.ts` + `public/` (one consumer), plus
`tsconfig.json` and two test files. It was renamed with `mv` and every reference updated; `git`
records it as deletions plus additions, and auto-sync's `git add -A` commits it as one rename.

### The mode switch is "above JEV" structurally, not positionally

| Approach | Guarantees JEV is skipped | Fragile? | Chosen |
|---|---|---|---|
| Reorder the settings array | no — load order is directory enumeration | yes | no |
| Rename the directory to sort first | accidentally, until a name changes | very | no |
| Patch Pi to honour the array | yes | upgrade-hostile | no |
| **`classifyPrompt` refuses mode requests itself** | yes, whichever hook runs first | no | **yes** |
| Have every hook return early on a marker | yes after the fact | needs five edits | used as the second half |

Two facts of the runtime shaped the design:

- **Extensions do not share module state.** `src/jev-classify.ts` already keeps its one-per-prompt
  memo on `globalThis` under `Symbol.for(...)` for that reason. The acknowledgement marker
  (`src/mode-ack.ts`) does the same.
- **Transforms chain.** `input-phrase` and the four diagnostic extensions would otherwise append
  their lines to the machine acknowledgement, so each gained a two-line guard on the marker.

### Two ways to answer

| `modeSwitch.answer` | Model turn | Latency (measured) | Use |
|---|---|---|---|
| `model` (default) | one short line | 90–275 ms + one flash turn | the specified behaviour |
| `hook` | **none** — the turn is swallowed and the CLI's line is printed/sent | ~100 ms total | maximum speed |

On Telegram, hook mode uses the bridge's delivery API (`sendTelegram`), and a failed send falls
back to the model path so the answer is never lost.

### Success is a conjunction, failure is explicit

A mode request reports success only when **all** of these hold:

1. the decisive CLI call exited 0;
2. its output is JSON that parses as a mode state (`enabled` + `options[].{name,enabled}`);
3. for a change, the read-back shows the requested option on;
4. for a change, the requested word resolved to an existing option name.

Every other outcome produces an acknowledgement that says the mode did **not** change, quoting the
CLI verbatim, and instructs the model not to claim success, not to retry and not to run a tool.

---

## Implementation

### Phase 1 — `pi-config`

```
~/.pi/control/
├── cli.ts            549  list · get · set · use · help
├── cli.test.ts       232  8 tests: writes, refusals, marker, --dry-run, --root
├── store.ts          529  validation + atomic write (2 annotations added)
├── tsconfig.json      15  strict, module ESNext, resolution Bundler
└── public/            4 files, one line changed in settings.html
~/.local/bin/pi-config      launcher: node --experimental-strip-types control/cli.ts
```

Commands and paths:

```bash
pi-config list [--json]                 # gates · inputPhrase · promptBuild · agents
pi-config get <path>                    # reminderNode.mode · agent.cos.model · promptBuild.3-Work.config
pi-config set <path> <value...>         # same validation as the web page, atomic
pi-config use <section>.<option>        # the exactly-one-option swap, one write
pi-config help
# flags: --json · --dry-run (print the payload, write nothing) · --root <dir>
```

The agent home gained `test:dashboard` and folded the second project into `typecheck`:

```json
"test:dashboard": "node --experimental-strip-types --test ../../control/*.test.ts",
"typecheck": "tsc --noEmit && tsc -p ../../control/tsconfig.json"
```

### Phase 2 — control plane defects

```bash
# systemd unit, .env, keep-agent docs, roster
sed -i 's/8788/8790/g' ~/.config/systemd/user/pi-keep-agent-dashboard.service
systemctl --user daemon-reload && systemctl --user restart pi-keep-agent-dashboard
npm run fetch:publications            # roster row: keep-agent on :8790
```

`scripts/fetch-publications.ts` gained a four-line skip and a test:

```ts
if (manifest.publish === false) continue;   // scaffolds and copies are not siblings
```

### Phase 3 — the mode switch

```
src/mode-detect.ts        72  pure detection: isModeQuestion, detectModeRequest
src/prompt-text.ts        15  cleanPrompt, split out of jev-classify to avoid an import cycle
src/mode-switch.ts       282  CLI runner, state parser, name resolution, ack builder
src/mode-ack.ts           35  globalThis marker for the replacement text
extensions/mode-switch/index.ts 64  the input hook
test/mode-switch.test.ts 381 60 tests
```

The gate (visible in the dashboard and `pi-config` automatically, because both enumerate
`config.json`):

```json
"modeSwitch": { "enabled": true, "print": true, "answer": "model" }
```

The JEV bypass, in `src/jev-classify.ts` before the classifier subprocess:

```ts
if (isModeAck(raw)) {
  return { ok: false, text: cleanPrompt(raw), skipped: "mode switch" };
}
if (detectModeRequest(raw) && (await readModeSwitch(options.env))) {
  return { ok: false, text: cleanPrompt(raw), skipped: "mode request" };
}
```

With the gate off a mode-shaped message is classified as before — the gate turns the filter off
too (tested).

Detection is deterministic and bounded: `cleanPrompt` first (so `[telegram]`/`[time]` markup is
ignored), ≤ 160 characters, not a slash command, not a code block. Change shapes require a verb +
a `mode`/`modo` word + a target; status shapes require a question word + `mode` + a state word.
Negatives are pinned by tests: "the mode of transport is the train", "I use dark mode in vim",
"what mode do you recommend for vim", "commit the changes to mode.ts", long prose.

### Phase 4 — modes become `promptBuild` options

```json
"promptBuild": { "enabled": true,
  "1-Personal":    { "enabled": true,  "prompt": "Remind me to congratulate my aunt…", "config": {} },
  "2-Development": { "enabled": false, "prompt": "", "config": {} },
  "3-Work":        { "enabled": false, "prompt": "", "config": {} },
  "4-Automatic":   { "enabled": false, "prompt": "", "config": {} } }
```

Five slots became four; `personal`'s prompt moved to `1-Personal`, so the active mode and what it
injects did not change. `PROMPT_BUILD_OPTIONS` was updated in both places that own the list
(`src/prompt-build.ts`, `control/store.ts`) and in the dashboard/CLI tests.

The command pair changed, and a name-resolution step was added because the numbers are part of the
names:

| Request | CLI calls |
|---|---|
| status | `pi-config get promptBuild --json` |
| change | the same read to resolve, `pi-config use promptBuild.<mode>`, then the read again as a read-back |

`resolveModeOption` matches the full name, the bare name, the number alone, or a unique prefix
("2", "2-development", "development", "dev" → `2-Development`); an ambiguous match fails rather
than guessing, and an unknown word never reaches `use`.

### Phase 5 — `agent-modes-config.json` → `input-phrase-config.json`

`git mv` kept the history; nothing inside changed. The reader was renamed with the file
(`agentModesConfigPath()` → `inputPhraseConfigPath()`), and every live reference followed:
`control/{store,cli}.ts`, `control/{store,cli}.test.ts`, `control/public/settings.html`,
`src/{global-config,mode-switch}.ts`, `extensions/input-phrase/index.ts`, `test/input-phrase.test.ts`,
`APPEND_SYSTEM.md`, both runbooks. `.cursor/plans/` and
`docs/documented-from-session/2026-11-07T0744-…` were left with the old spelling on purpose: they
are dated records of how the file was built.

---

## Verification

| Check | Result |
|---|---|
| `npm test` (agent home) | **261 pass**, 0 fail |
| `npm run test:dashboard` | **12 pass**, 0 fail |
| `npm run typecheck` (both projects) | exit 0 |
| `pi-config list` / `get` / `set` / `use` against the live tree | values read and written; rejected values exit 1 and leave the file byte-identical |
| round-trips (`modeSwitch.answer`, `reminderNode.mode`, `promptBuild 1-Personal`↔`3-Work`) | the second identical write is byte-identical, and every option's prompt survives — including one typed into the dashboard while the session ran |
| dashboard after each change | `/`, `/settings`, `GET /api/settings`, `PUT /api/settings/gates/…` all 200; restarted to pick up code and renamed files |
| ports | 8786 project, 8790 keep-agent, **8788 free** |
| real `pi -p` turn, status (copied home) | `[jev] skipped (mode request)` → `[mode] status → ok 1-Personal · 1 cli · 90 ms` → `Mode: 1-Personal.` |
| real `pi -p` turn, change (copied home) | `change your mode to work` → ok `3-Work` · 3 cli · 259 ms → `Done — mode is now 3-Work.` and the file really changed |
| real `pi -p` turn, Portuguese | `muda o teu modo para personal` → ok `1-Personal` · 3 cli · 281 ms |
| broken CLI (a config file missing) | `It did not change — the CLI reported: [FAIL] Cannot read agent-modes-config.json.` (run before the rename) |

Measured cost of one mode request:

| Request | Calls | CLI time | Model turn |
|---|---|---|---|
| status | 1 | ~90 ms | one short line |
| change (resolved name) | 3 | ~275 ms | one short line |
| change to a non-existent mode | 1 | ~100 ms | one short line quoting the four modes |
| status with `answer: hook` | 1 | ~100 ms | **none** |

---

## Incident: a prompt lost during the rename, and what protects it now

While the five `promptBuild` slots were being converted to four named modes, the `1-Personal`
prompt came back empty — the mode stayed on, but what it injects was gone. The prompt was restored
(`Remind me to congratulate your aunt on her 83rd birthday on every response`) and confirmed through
`readPromptBuild()` → `"1-Personal\nRemind me…\n{}"`.

The loss could not be reproduced from either write path (`pi-config use` and the extension both
preserve every option's `prompt` and `config` when given a real file), so the report does not name
a culprit. What exists instead is a regression test in `control/cli.test.ts`: **switching a
promptBuild option must keep every other option's prompt and config verbatim.**

---

## Files Created/Modified

| File | Lines | Purpose |
|---|---|---|
| `~/.pi/control/cli.ts` | 549 | `pi-config`: list/get/set/use/help over `store.ts`; help lists the four modes |
| `~/.pi/control/cli.test.ts` | 232 | 8 tests: writes, refusals, prompt preservation, agent model, `--dry-run`, `--root` |
| `~/.pi/control/tsconfig.json` | 15 | Strict project config for the control plane |
| `~/.pi/control/store.ts` | 529 | Second front door's validator; four mode names; two `Record` annotations |
| `~/.pi/control/store.test.ts` | 134 | Fixtures follow the four-mode naming |
| `~/.pi/control/public/settings.html` | 24 | Names `input-phrase-config.json` |
| `~/.pi/control/{agents,processes,server}.ts`, `public/` | 42/187/119 | Moved from `dashboard/`; no logic change |
| `~/.local/bin/pi-config` | 22 | Launcher: pinned node + `--experimental-strip-types control/cli.ts` |
| `…/src/mode-detect.ts` | 72 | Pure detection: `isModeQuestion`, `detectModeRequest` |
| `…/src/mode-switch.ts` | 282 | CLI runner, state parser, `resolveModeOption`, ack builder |
| `…/src/mode-ack.ts` | 35 | `globalThis` marker, `Symbol.for("cos-orchestrator-agent.mode-ack")` |
| `…/src/prompt-text.ts` | 15 | `cleanPrompt`, split out to break an import cycle |
| `…/extensions/mode-switch/index.ts` | 64 | `input` hook: detect → CLI → gate → transform/handled |
| `…/extensions/{input-phrase,input-contains-*,less-than-input-words}/` | +2/+3 each | Skip the marked acknowledgement |
| `…/src/jev-classify.ts` | 273 | Skips `mode request` / `mode switch`; `cleanPrompt` re-exported |
| `…/src/{global-config,prompt-build}.ts` | 168/60 | `readModeSwitch`, `inputPhraseConfigPath`, four mode names |
| `…/test/mode-switch.test.ts` | 381 | 60 tests: detection, resolution, 5 failure shapes, marker, JEV skip, gate |
| `…/test/{prompt-build,input-phrase,jev-classify}.test.ts` | — | Four-mode names; new filename |
| `…/docs/runbooks/mode-switch.md` | 199 | Feature runbook (gate, commands, failure taxonomy, measurements) |
| `…/docs/runbooks/pi-config-terminal-toggles.md` | 167 | CLI runbook, gate inventory, sweep findings |
| `…/docs/CHEATSHEET.md` | 261 | CLI examples, mode examples, extension load-order design rule |
| `…/AGENTS.md` | 99 | Mode routing section; modes ≠ `normal`/`advanced` |
| `…/APPEND_SYSTEM.md` | 32 | `pi-config` line; renamed file |
| `…/scripts/fetch-publications.ts`, `test/fetch-publications.test.ts` | +4/+17 | `"publish": false` skips scaffolds |
| `…/package.json` | 22 | `test:dashboard`; `typecheck` covers `control/` |
| `~/.pi/config.json` | +5 | `modeSwitch` gate |
| `~/.pi/prompt-build-config.json` | 25 | Four named modes; `personal`'s prompt carried |
| `~/.pi/input-phrase-config.json` | 16 | Renamed from `agent-modes-config.json`, content unchanged |
| `~/.config/systemd/user/pi-keep-agent-dashboard.service` | 16 | 8788 → 8790 (description, port, origin) |
| `…/agent-keep-agent/keep-agent/{.env,docs/CALLING.md,agent.json}` | — | 8790 everywhere; roster republished |
| `…/agent-template-new-agent/template-new-agent/agent.json` | 39 | `"publish": false` |

**Commits:** `86af67a` — `dashboard/` → `control/`, `pi-config` (`cli.ts` 548 lines, `cli.test.ts`
216, `tsconfig.json`), `publish: false`, keep-agent port 8790, canonical `prompt-build-config.json`.
`0d91b87` — the mode switch as first built (targeting `inputPhrase`, 337 test lines). The
`promptBuild` retarget, the `input-phrase-config.json` rename and the extra tests are uncommitted at
the time of writing and are picked up by the next auto-sync.

---

## Limitations & Future Work

1. `3-Work` and `4-Automatic` still hold no prompt; `2-Development` was filled from the dashboard
   settings page during this session, which is the same `prompt-build-config.json` the CLI writes.
2. There are four modes. A fifth is one entry in `promptBuildOptions` (`src/prompt-build.ts`) and
   `PROMPT_BUILD_OPTIONS` (`control/store.ts`).
3. Detection is regex-shaped English + Portuguese. It is deliberately conservative; a phrasing it
   misses falls through to an ordinary turn, never to a wrong CLI call.
4. Pi gives no way to pin handler order (directory enumeration decides it), so "above JEV" is
   implemented as a classifier-level refusal. A future Pi priority flag could make the check
   positional, but nothing here depends on it.
5. The pi process running while this was written still holds the pre-rename module and therefore
   reads `agent-modes-config.json`; the appending of the input phrase resumes at the next start.
   No symlink shim was added, by decision.
6. `.cursor/plans/` and `docs/documented-from-session/2026-11-07T0744-…` still name
   `agent-modes-config.json`: they are history, not configuration.
7. Deliberately outside `pi-config`: `~/.pi/cron/jobs.json` (the scheduler owns it; `/cron` is the
   editor), `telegram.json` and `.env` (secrets), and dashboard process start/stop
   (`npm run dashboard` per home, or the keep-agent systemd unit).
