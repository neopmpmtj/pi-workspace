---
name: Append input phrase
overview: When inputPhrase is enabled, exactly one option must be enabled. The turn then appends append1 and that option's phrase. Zero options or more than one appends nothing and prints the conflict.
todos:
  - id: config-section
    content: Shape inputPhrase with enabled, append1, normal on, and advanced off
    status: completed
  - id: append-fn
    content: Add appendInputPhrase and readInputPhrase with an exactly-one option check
    status: completed
  - id: extension
    content: Register the input-phrase extension after the existing input gates
    status: completed
  - id: tests
    content: Cover exactly one option, zero options, and more than one option
    status: completed
isProject: false
---

# Append inputPhrase lines to each user turn

[`config.json`](/home/pmpmt/.pi/config.json) already has an `inputPhrase` section with only `append1`. That section becomes the switch, and it gains option entries. Pi's `input` hook rewrites the submitted text before skill expansion and before the turn. The rewritten text is the user message the model receives.

```json
"inputPhrase": {
  "enabled": true,
  "append1": "Congratulate me for my 31st birthday",
  "normal": {
    "enabled": true,
    "phrase": "respond in a single sentence"
  },
  "advanced": {
    "enabled": false,
    "phrase": "respond with a brief explanation"
  }
}
```

`normal` starts on so the shipped section is valid. `advanced` starts off.

`enabled` on the section is the master switch, same rule as the other sections: only boolean `true` runs. A missing section, a missing `enabled`, or any other value appends nothing and prints nothing.

## Options are alternatives

`normal` and `advanced` are the option entries. They contradict each other: a single sentence and a brief explanation cannot both be asked. Later options are added to the same list, and the check does not grow a special case per pair. The list lives in one place, `inputPhraseOptions`, currently `["normal", "advanced"]`.

Only boolean `true` counts as on. A string `"true"` is off.

When the section is on, the number of on options must be exactly one.

- Exactly one: append `append1` when it is a non-empty string, then that option's `phrase` when that is a non-empty string.
- Zero: the section looks on and every option is off. Append nothing, including `append1`. Print `inputPhrase: enabled but no option is enabled`.
- More than one: the on options contradict each other. Append nothing, including `append1`. Print `inputPhrase: normal and advanced are both enabled`, naming whichever options are on.

The print uses the same path as the other gates: `ctx.ui.notify` in the TUI, stdout otherwise.

With the section on, `append1` set, and only `normal` on, `hello` is sent as:

```text
hello
Congratulate me for my 31st birthday
respond in a single sentence
```

Leading and trailing whitespace on each phrase is dropped. Internal newlines in a phrase stay. The user text keeps its own trailing newline stripped so the first phrase starts on the next line. If the one selected option has a blank phrase and `append1` is blank, the input is left unchanged and no conflict is printed.

## Where it runs

Only the main agent, [`agent/cos-orchestrator-agent`](/home/pmpmt/.pi/agent/cos-orchestrator-agent). Register the extension in [`settings.json`](/home/pmpmt/.pi/agent/cos-orchestrator-agent/settings.json) after `calendar-node`, `reminder-node`, and the four input gates, and before `secret-scrubber`. Those earlier `input` handlers then still see the original words. A turn they mark `handled` never reaches this hook.

Skip:

- `source === "extension"` (extension-sent prompts)
- text that starts with `/` (skill and template expansion runs after `input`; a trailing line would break the command name)

`before_agent_start` still sees the combined prompt, so the hidden word-count, path, URL, and email lines are computed on the text that includes the phrases. The on-screen true/false lines stay on the original text.

## Code

Follow the existing gate split: a pure function, a config reader, a thin extension, a test.

- [`src/input-phrase.ts`](/home/pmpmt/.pi/agent/cos-orchestrator-agent/src/input-phrase.ts) — `inputPhraseOptions` and `appendInputPhrase(text, lines)`. The option list is the only place a new alternative is added.
- [`src/global-config.ts`](/home/pmpmt/.pi/agent/cos-orchestrator-agent/src/global-config.ts) — `readInputPhrase()` uses `readEnabledSection("inputPhrase")`. It returns null when the section is off. When the section is on it returns either the lines to append or a `conflict` string. The count of on options decides which.
- [`extensions/input-phrase/index.ts`](/home/pmpmt/.pi/agent/cos-orchestrator-agent/extensions/input-phrase/index.ts) — `registerInputPhrase`. On `input`, print `conflict` when set and return `{ action: "continue" }`. Otherwise return `{ action: "transform", text }` when there is at least one line.
- [`test/input-phrase.test.ts`](/home/pmpmt/.pi/agent/cos-orchestrator-agent/test/input-phrase.test.ts) — section off, exactly one option, zero options, both options, a string `"true"` counting as off, blank phrases, slash and extension skips, missing file.

Pi loads extensions at startup, so a running `pi` session needs a restart before the phrases are appended.
