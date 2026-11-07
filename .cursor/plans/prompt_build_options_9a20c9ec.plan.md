---
name: Prompt build options
overview: Add a five-way prompt-build config. Exactly one option is on, and that option’s prompt and settings object are inserted as one section of the system prompt Pi builds for the turn.
todos:
  - id: prompt-build-file
    content: Add ~/.pi/prompt-build-config.json with personal and option1–option4, option1 on, prompts and configs empty
    status: completed
  - id: prompt-build-reader
    content: Parse the section in src/prompt-build.ts and read it from global-config.ts
    status: completed
  - id: prompt-build-hook
    content: On before_agent_start, set or delete sections.prompt_build and register the extension
    status: completed
  - id: prompt-build-tests
    content: Cover the exactly-one rule, empty selection, and section text
    status: completed
  - id: prompt-build-settings
    content: Add a settings card that reads and writes the five options
    status: completed
isProject: false
---

# Prompt build options

Personal is one of five options. Exactly one of `personal`, `option1`, `option2`, `option3`, and `option4` is on. The selected option’s prompt and its settings object are written into the system prompt. They do not change tools or other files. The four keys stay placeholders so they can be renamed and filled afterward. The existing user-message phrase in [agent-modes-config.json](/home/pmpmt/.pi/agent-modes-config.json) and the static [APPEND_SYSTEM.md](/home/pmpmt/.pi/agent/cos-orchestrator-agent/APPEND_SYSTEM.md) stay as they are.

## How the prompt is built

Installed pi is `@earendil-works/pi-coding-agent` **1.5.0**. That matches the current extension docs: [before_agent_start](https://pi.dev/docs/latest/extensions) exposes a mutable `event.systemPromptOptions`. Custom text belongs in `sections`, keyed by a name matching `^[a-z][a-z0-9_-]*$`. Pi wraps that key in a tag and, when the text changes, patches only that section. Returning `systemPrompt`, or setting `forceSystemPrompt`, replaces the whole prompt. This hook only sets or deletes `sections.prompt_build`.

`APPEND_SYSTEM.md` is loaded into `appendSystemPrompt` and rendered as the single `addendum` section in [system-prompt.js](/home/pmpmt/.nvm/versions/node/v24.21.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js). A selectable option cannot live there. An empty section value is omitted by that same builder, so a blank selection adds no tag.

```mermaid
flowchart LR
  file[prompt-build-config.json]
  hook[before_agent_start]
  section[sections.prompt_build]
  built[System prompt]
  file --> hook --> section --> built
```

## Config

New file [prompt-build-config.json](/home/pmpmt/.pi/prompt-build-config.json), beside `config.json`. Shipped with the section on, `option1` on, and the other four off. Every prompt is `""` and every config is `{}`.

```json
{
  "promptBuild": {
    "enabled": true,
    "personal": { "enabled": false, "prompt": "", "config": {} },
    "option1": { "enabled": true, "prompt": "", "config": {} },
    "option2": { "enabled": false, "prompt": "", "config": {} },
    "option3": { "enabled": false, "prompt": "", "config": {} },
    "option4": { "enabled": false, "prompt": "", "config": {} }
  }
}
```

Rules, same shape as [input-phrase.ts](/home/pmpmt/.pi/agent/cos-orchestrator-agent/src/input-phrase.ts):

- The section runs only when `enabled` is boolean `true`.
- Exactly one of the five `enabled` flags is boolean `true`. Zero or more than one is a conflict: the hook prints one line and sets no section.
- `prompt` is a string, including `""`. `config` is a JSON object. Anything else is ignored for that field (prompt treated as absent, config treated as `{}`).
- A selected option whose prompt is blank and whose config is `{}` sets no section, so the placeholder file does not change the live prompt.
- Otherwise the section body is the option key, the prompt text, and `JSON.stringify(config, null, 2)`.

## Hook

Cos orchestrator only.

- [src/prompt-build.ts](/home/pmpmt/.pi/agent/cos-orchestrator-agent/src/prompt-build.ts) holds the five keys, the parsed result, and the section text.
- [src/global-config.ts](/home/pmpmt/.pi/agent/cos-orchestrator-agent/src/global-config.ts) gains `promptBuildConfigPath()` and `readPromptBuild()`, using `readEnabledSection` against the new file.
- [extensions/prompt-build/index.ts](/home/pmpmt/.pi/agent/cos-orchestrator-agent/extensions/prompt-build/index.ts) listens to `before_agent_start` for both user and custom runs, so the section stays in place whichever kind of run starts. It assigns `event.systemPromptOptions.sections.prompt_build`, or deletes that key on off, conflict, or empty. It does not return `systemPrompt`.
- Register `+extensions/prompt-build/index.ts` in [settings.json](/home/pmpmt/.pi/agent/cos-orchestrator-agent/settings.json). A pi process already running loads it on the next start. After that, edits to the JSON apply on the next turn.

## Settings page

One new card on the project dashboard settings page, saved on its own. Five radios, a prompt field, and a config JSON field for each option. A bad JSON value, or a section that is on with a count other than one, returns 400 and the file is not written. The card reads and writes [prompt-build-config.json](/home/pmpmt/.pi/prompt-build-config.json) only.

## Tests

Unit tests for the parser and the section text: exactly one option, both personal and option1 on, all five off, blank prompt with empty config, blank prompt with a non-empty config, and a non-object config. No network.
