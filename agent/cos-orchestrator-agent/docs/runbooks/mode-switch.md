# Runbook — mode switch (the hook above JEV)

Built 2026-11-07. Turns "what mode are you on" and "change your mode to work" into one to
three control-plane CLI calls, with no classifier and no decision node in the path.

## What a mode is here

A mode is the enabled option of **`promptBuild`** in `~/.pi/prompt-build-config.json`, the
session-level layer: the selected option contributes one section to the system prompt
(`before_agent_start` → `sections.prompt_build`). Four modes, named 2026-11-07:

| Mode | Meaning |
| --- | --- |
| `1-Personal` | the option that was called `personal`; carries the user's own standing prompt |
| `2-Development` | development work |
| `3-Work` | work |
| `4-Automatic` | left blank for the agent to drive |

```json
"promptBuild": { "enabled": true,
  "1-Personal":    { "enabled": true, "prompt": "…", "config": {} },
  "2-Development": { "enabled": false, "prompt": "", "config": {} },
  "3-Work":        { "enabled": false, "prompt": "", "config": {} },
  "4-Automatic":   { "enabled": false, "prompt": "", "config": {} } }
```

Exactly one option is on while the section is on. `promptBuild.enabled: false` means the
section is off; the option flags still record which mode is selected, and the answer says so.

**`normal` and `advanced` are not modes.** They belong to `inputPhrase` in
`~/.pi/input-phrase-config.json`, a per-turn feature that appends a phrase to each typed
message. The mode switch does not touch it, and the phrase appenders skip the machine-generated
acknowledgement.

`option1..option4` and the old `personal` key are gone from the config; `personal`'s prompt
moved to `1-Personal`, so the active mode and what it injects did not change.

## Where it sits

`extensions/mode-switch/index.ts` runs its `input` hook, does the CLI work, and replaces the
message. What makes it "above JEV" is **not** its position in the load list — pi loads
extensions in directory-enumeration order (`readdirSync`), not in the order of the `extensions`
array in `settings.json` (checked 2026-11-07: zzz/aaa/mmm listed in that order loaded
aaa/mmm/zzz). It is that **`classifyPrompt` itself refuses mode requests and mode
acknowledgements**, so the JEV classifier is never asked about one, no matter which hook runs
first:

```ts
// src/jev-classify.ts, before the classifier subprocess
if (isModeAck(raw)) return { skipped: "mode switch" };
if (detectModeRequest(raw) && (await readModeSwitch(options.env))) return { skipped: "mode request" };
```

With `modeSwitch.enabled` false, a mode-shaped message is classified exactly as before — the
gate turns the whole layer off, filter included (tested).

The input hooks that follow (in whatever order they run) agree to leave the replacement alone:

| Hook | What it would otherwise do | Guard |
| --- | --- | --- |
| `src/jev-classify.ts` (`classifyPrompt`) | one classifier subprocess (~250 ms) per message | returns `skipped: "mode request"` for the request and `skipped: "mode switch"` for the acknowledgement; the decision-node hooks print `[jev] skipped (…)` and continue |
| `extensions/input-phrase` | appends `append1` and the mode phrase to the text | skips a marked text |
| `extensions/input-contains-{email,path,url}`, `less-than-input-words` | screen true/false and a hidden diagnostic block | skip a marked text |

The marker itself is `src/mode-ack.ts`: the replacement text is remembered on `globalThis`
under a registered symbol, because pi gives every extension its own module cache.

Registration order still matters for one thing only: a hook that runs **before** mode-switch
reads the user's message rather than the replacement, so its `[jev]`/true-false lines describe
the request. Nothing it does is expensive or wrong.

## Gate

`~/.pi/config.json`, editable from the dashboard settings page and from the CLI:

```json
"modeSwitch": { "enabled": true, "print": true, "answer": "model" }
```

| Field | Meaning |
| --- | --- |
| `enabled` | the whole hook. Off → the message reaches JEV and the model as usual |
| `print` | the `[mode] …` trace line on screen (`ui.notify` in the TUI, stdout in `-p`) |
| `answer` | `model` (default): replace the message with an acknowledgement and let one short turn report it. `hook`: print the CLI's own line and finish the turn with **no model call**. `pi-config` and `:8786` reject any other string. A hand-edited unknown value still means `model`. |

```bash
pi-config get modeSwitch
pi-config set modeSwitch.enabled off
pi-config set modeSwitch.answer hook
```

## The commands it runs

| Request | CLI calls |
| --- | --- |
| status | `pi-config get promptBuild --json` |
| change | the same read to resolve the name, `pi-config use promptBuild.<mode>`, then the read again as a read-back |

Name resolution (`resolveModeOption`): exact case-insensitive name, then the name without its
number, then the number alone, then a unique prefix — so "development", "2-development", "2" and
"dev" all reach `2-Development`, while "turbo" fails without ever calling `use` and the failure
quotes the four modes that exist. An ambiguous match fails rather than guessing.

The CLI is spawned as `node --experimental-strip-types ~/.pi/control/cli.ts …` with the node
that runs pi. No shell, no PATH, no credentials. 15 s timeout, killed with `SIGKILL`.

## What the model receives

With `answer: model`, the user's text is replaced by one of these. Nothing else about the
turn changes; the reply is one line because the result is already in the prompt.

```text
Already executed by the pi-config CLI, which succeeded: the agent's mode is now "3-Work" (promptBuild on).
Reply in one short line, for example: Done — mode is now 3-Work.
Do not run a tool, do not verify, do not explain.
```

## Failure means failure

A mode request reports success only when **all** of this holds: the CLI exited 0, its output
parsed, and (for a change) the read-back shows the requested option on. Every other outcome
produces the failure acknowledgement, which quotes the CLI verbatim and tells the model to say
the mode did **not** change:

```text
Already executed by the pi-config CLI, which FAILED: the change to "turbo" did not happen.
What the CLI said: no mode "turbo" · promptBuild has 1-Personal, 2-Development, 3-Work, 4-Automatic
Reply in one short line saying it did not change, quoting that reason. Do not claim success, do not retry, do not run a tool.
```

Covered failures: non-zero exit, timeout, unparseable JSON, no mode state in the JSON, and a
read-back that disagrees with the change (`the CLI reported success but the mode reads back as
3-Work`), and a name that resolves to no mode at all.

## Detection

Deterministic, in `src/mode-switch.ts` (`detectModeRequest`), pure and unit-tested. Input is
cleaned first (`cleanPrompt`, so `[telegram]`/`[time]` markup is ignored), must be under 160
characters, must not be a slash command or a code block.

- **change** — a verb (`change`, `switch`, `set`, `switch to`, `use`, `activate`, `muda`,
  `passa`, `troca`, `ativa`, …) with a `mode`/`modo` word and a target: "change your mode to
  work", "switch to development mode", "set mode automatic", "muda o teu modo para personal".
- **status** — a question about the mode with a state word: "what mode are you on", "what mode
  are we running on", "what is the current mode", "which mode is active", "mode status",
  "qual é o modo atual", "em que modo estás".
- **Not matched** on purpose: "the mode of transport is the train", "I use dark mode in vim",
  "what mode do you recommend for vim", "commit the changes to mode.ts", and any long
  paragraph that merely mentions a mode.

An unknown target is still handed to the CLI ("change mode to turbo"), because the CLI's
refusal is the honest answer and it lists the modes that exist.

## Measured (laptop, 2026-11-07)

| Request | Calls | Wall clock | Model turn |
| --- | --- | --- | --- |
| "what mode are you on" | 1 | ~90 ms | yes, one short line |
| "change your mode to development" | 3 | ~275 ms | yes, one short line |
| "change your mode to turbo" (no such mode) | 1 | ~100 ms | yes, one short line quoting the modes |
| same status, `answer: hook` | 1 | ~100 ms | **none** |
| a whole `pi -p` turn, status | 1 | ~1.7 s total (node + flash turn) | "Mode: 1-Personal." |
| a whole `pi -p` turn, change | 3 | ~2 s total | "Done — mode is now 3-Work." |

The last two rows are a real `pi -p` run in a copy of the home: JEV printed `skipped (mode
request)` and `skipped (mode switch)`, the model answered one line, and the file really changed.

## Tests

```bash
cd ~/.pi/agent/cos-orchestrator-agent && node --experimental-strip-types --test test/mode-switch.test.ts
```

56 cases: detection (change/status forms in English and Portuguese, and the negatives above),
`parseModeState`, the CLI runner against a missing CLI, all five failure shapes, the marker,
the JEV skip, and the gate reader. The full suite is 257 tests.

## Manual end-to-end check

Two checks were run on 2026-11-07 against the live code:

1. **The extension alone** — register it with a fake `pi`, take its `input` handler, and call
   it with a message. Status, an unknown-mode failure, a real change, and a non-mode message
   that returned `continue` in 0 ms.
2. **A real turn** — a copy of the home under `/tmp` (its own `config.json`, its own
   `control/cli.ts`, no packages, four extensions) run as
   `pi -p --no-session "change your mode to work"`. Output:

   ```text
   [jev]   skipped (mode request)
   [mode]  change to "work" → ok 3-Work · 3 cli · 259 ms
   [jev]   skipped (mode switch)
   Done — mode is now 3-Work.
   ```

   and the copied `prompt-build-config.json` really had `3-Work` on. A Portuguese request
   ("muda o teu modo para personal") switched it back. The same setup with a broken CLI (a
   config file missing) answered "It did not change — the CLI reported: `[FAIL] Cannot read
   input-phrase-config.json.`" — the anti-false-positive path, end to end.
