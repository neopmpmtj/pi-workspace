# web-master: calling contract

For another agent calling this one from the shell. Human reference: [CHEATSHEET.md](CHEATSHEET.md).

## Default call

```bash
cd ~/pi-agents-experts-grouped/web-master/web-master && pi-web-master -p "/ask <question>"
```

This is the call whenever you delegate to web-master, including a question about the web. `/ask` is one provider call. It does not load the chat bootstrap.

## Research call

```bash
cd ~/pi-agents-experts-grouped/web-master/web-master && pi-web-master -p "<question>"
```

Use this only when the user asked for advanced search, deep search, or research. The message must not start with `/ask`. It starts one chat turn, which loads the bootstrap files and uses `web_search`, `fetch_content`, and `get_search_content` itself. Do not name a provider on those tools. The caller sends the question. The process exits when that turn finishes.

- Run from the agent home so the session folder and `logs/ledger.sqlite` land in the right place.
- Do not call `/usage` unless the user asks about this agent's usage.

## Output

- `/ask` stdout: the answer.
- `/ask` stderr: the token and cost line, or `[FAIL] <reason>`.
- A prompt with no slash: Pi prints the assistant reply.
- No `[FAIL]` line means the `/ask` command did not fail.

Save flags write `default-web-master-model.json` and make no provider call. Use them only when the user asks to change a standing default.

<!-- BEGIN GENERATED: commands -->
<!-- Written by scripts/publish.ts. Change the extension code, then run npm run publish:agent. -->

## Slash commands

### /usage

Tokens and cost: /usage · /usage --usage-totals · /usage --this-session · /usage --web-search · /usage <runId> · /usage --help

```text
/usage
/usage --usage-totals | --this-session | --web-search | <run-id>
/usage --help

Prints this text and does not read the ledger.

--usage-totals   Totals per provider and model.
--this-session   This session only.
--web-search     Web searches per provider, with cost.
<run-id>         One run by id prefix.

With no selector, /usage shows the last run.
```

### /ask

One request, no chat turn: /ask "question". /ask --help lists the flags.

```text
/ask "question" [--web-master-model ID] [--web-master-provider ID] [--web-master-effort LEVEL] [--web-master-prompt TEXT] [--web-master-timeout SECONDS]
/ask --set-default-web-master-provider ID | --set-default-web-master-model ID | --set-default-web-master-effort LEVEL
/ask --help

Prints this text and does not call a provider or write a file.

--web-master-model ID                  Model id, or provider/id. This run only. A bare id does not keep the saved provider.
--web-master-provider ID               deepseek, openai, or google. Needs --web-master-model.
--web-master-effort LEVEL              off, default, minimal, low, medium, high, xhigh, or max. This run only.
--web-master-prompt TEXT               Replaces the /ask system prompt for this run. Does not write prompts.json.
--web-master-timeout SECONDS           Seconds for one request. No default.
--set-default-web-master-provider ID   Save the provider in default-web-master-model.json. May be combined with --set-default-web-master-model.
--set-default-web-master-model ID      Save the model in default-web-master-model.json. May be combined with --set-default-web-master-provider.
--set-default-web-master-effort LEVEL  Save the effort in default-web-master-model.json. Use it alone.

A save does not ask. Do not combine save flags, except --set-default-web-master-provider with --set-default-web-master-model.
```

## Tools (chat model only)

None.

<!-- END GENERATED: commands -->
