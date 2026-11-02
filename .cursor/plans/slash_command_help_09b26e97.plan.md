---
name: Slash command help
overview: Yes. image-describer already has `/describe-images --help`, which prints a fixed help text and does not run. Add the same short-circuit for `/ask` and `/usage` in the orchestrator, writing the text to stdout in print mode the way those commands already report results.
todos:
  - id: ask-help
    content: Add ASK_HELP / askHelp and short-circuit the /ask handler before parseAskArgs; mention --help in the unknown-flag error
    status: completed
  - id: usage-help
    content: Add USAGE_HELP / usageHelp and short-circuit the /usage handler before the ledger
    status: completed
  - id: tests
    content: Cover both helpers in args.test.ts and usage.test.ts
    status: completed
isProject: false
---

# Slash command `--help`

**image-describer already has this.** [`image-describer/image-describer/src/args.ts`](image-describer/image-describer/src/args.ts) exports `DESCRIBE_HELP` and `commandHelp`. The handler in [`extensions/describe-images/index.ts`](image-describer/image-describer/extensions/describe-images/index.ts) checks `--help` before parsing, prints the text, records the command, and returns. Other flags on the same line are ignored. Unknown flags say `Use --help.`

`/ask` and `/usage` do not. Today `/ask --help` fails with `Missing value for --help` ([`parseAskArgs`](cos-orchestrator-agent/cos-orchestrator-agent/src/args.ts) treats every `--` token as a flag that needs a value). `/usage --help` falls through to the last run, because anything starting with `--` other than `--all` and `--session` is treated as “last” in [`extensions/chat/index.ts`](cos-orchestrator-agent/cos-orchestrator-agent/extensions/chat/index.ts).

## Behavior

Match image-describer: if any token is `--help`, print help and do not ask, save a default, or read the ledger. Other tokens on that line are ignored.

Print mode follows this agent’s existing path (`toStdout` via `writeSync` to fd 1), plus `sendMessage` with `display: true` and `triggerTurn: false`, and `recordCommandIfUnsaved`. No notify, no non-zero exit.

Point the existing unknown-flag error at the new text: `Unknown flag ${token}. Use --help.` The current test only matches `Unknown flag --nope`, so it still passes.

## `/ask`

Add `ASK_HELP` and `askHelp(input)` next to `tokenize` in [`src/args.ts`](cos-orchestrator-agent/cos-orchestrator-agent/src/args.ts). `askHelp` returns the text when `tokenize` includes `--help`, otherwise `undefined`.

Help text, kept short:

- `/ask "question" [--provider ID] [--model ID] [--effort LEVEL] [--timeout SECONDS]`
- `/ask --set-default-provider ID | --set-default-model ID | --set-default-effort LEVEL`
- `/ask --help`
- One line: prints this text and does not send a request or write `default-model.json`.
- Flag lines: provider `deepseek`, `openai`, `google`; model id or `provider/id`; effort `off`, `default`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; timeout in seconds; save flags write the default and make no request. `--set-default-provider` and `--set-default-model` may be used together. `--set-default-effort` is alone. A save cannot be combined with a question or a run flag.

In the `ask` handler, call `askHelp` before `parseAskArgs` and return on a hit.

## `/usage`

Add `USAGE_HELP` and `usageHelp(input)` in [`src/usage.ts`](cos-orchestrator-agent/cos-orchestrator-agent/src/usage.ts), using the same tokenize-includes-`--help` check (import `tokenize` from `args.ts`, or a local split; reuse `tokenize` so quotes behave the same).

Help text:

- `/usage` — last run
- `/usage --all` — totals per provider and model
- `/usage --session` — this session only
- `/usage <runId>` — one run by id prefix
- `/usage --help` — prints this text and does not read the ledger

In the `usage` handler, call `usageHelp` before opening the ledger or syncing sessions.

## Tests

- [`test/args.test.ts`](cos-orchestrator-agent/cos-orchestrator-agent/test/args.test.ts): `askHelp("--help")` equals `askHelp('--help "question" --model x')`, `askHelp("question")` is `undefined`, and the text mentions `--model` and `--set-default-effort`.
- [`test/usage.test.ts`](cos-orchestrator-agent/cos-orchestrator-agent/test/usage.test.ts): same for `usageHelp("--help")` and `usageHelp("--help --all")`, with `usageHelp("--all")` undefined, and the text mentioning `--session`.
