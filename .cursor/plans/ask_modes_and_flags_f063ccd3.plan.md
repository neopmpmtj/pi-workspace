---
name: Ask modes and flags
overview: The orchestrator always calls web-master with -p "/ask …" (one provider call). A prompt with no slash starts a chat, and that path is only for advanced search, deep search, or research. Web-master joins the sibling roster through agent.json and CALLING.md.
todos:
  - id: launcher
    content: Stop wrapping a bare -p message as /ask, so a prompt with no slash stays a chat turn
    status: completed
  - id: ask-only
    content: Make /ask always the direct provider call; remove --web-master-mode and default-web-master-mode.json
    status: completed
  - id: publish
    content: Add agent.json, docs/CALLING.md, and npm run publish:agent
    status: completed
  - id: roster
    content: Name the research exception in the orchestrator's standing sibling rule, then fetch:publications
    status: completed
isProject: false
---

# Web-master on the sibling roster

## What changed in the codebase

Siblings are no longer described by hand. Each agent home publishes `agent.json` (`name`, `launcher`, `defaultPrompt`, `purpose`, `contract`, `commands`). `npm run publish:agent` (image-describer's [`scripts/publish.ts`](image-describer/image-describer/scripts/publish.ts)) fills `commands`, `tools`, and the generated block of `docs/CALLING.md` from the extension. The orchestrator runs `npm run fetch:publications`, which reads `*/*/agent.json` and rewrites only the table between the markers in [`APPEND_SYSTEM.md`](cos-orchestrator-agent/cos-orchestrator-agent/APPEND_SYSTEM.md). It does not import sibling code.

Web-master has no `agent.json`, so it is absent from that table. The only published sibling is image-describer. The standing rule above the table says to always send the sibling's slash command, because natural language starts that agent's chat and re-sends its whole prompt.

`/ask` is already the cheap path: [`runAsk`](web-master/web-master/src/ask.ts), one provider call, no bootstrap, no web tools. `--web-master-mode advanced` is a second door into the same chat. The launcher in `~/.local/bin/pi-web-master` also rewrites a bare `-p` message into `/ask` unless it starts with `/` or whitespace.

## Calling rule

Two calls, chosen by the orchestrator. The cheap one is the default.

```bash
cd ~/pi-agents-experts-grouped/web-master/web-master && pi-web-master -p "/ask <question>"
```

This is the call whenever the orchestrator delegates to web-master, including a question about the web. It is one provider call, which is why it stays the cheap path.

```bash
cd ~/pi-agents-experts-grouped/web-master/web-master && pi-web-master -p "<question>"
```

That starts a chat turn. Pi loads `AGENTS.md` and `APPEND_SYSTEM.md`, and the pinned `pi-web-access` tools (`web_search`, `fetch_content`, `get_search_content`) are available. Use it only when the user asks for advanced search, deep search, or research. Each such call is a new print-mode session: one question, tool use allowed inside that turn, then the process exits. It is not a standing conversation.

The words are the trigger for the chat. Any other delegation, including one that needs a current fact, stays on `/ask`.

The launcher must stop inserting `/ask`. A message whose first character is `/` is a slash command. Any other message is the chat. The leading-space escape goes away with the wrap.

## /ask

`/ask` has no mode. Remove `--web-master-mode`, `--set-default-web-master-mode`, `default-web-master-mode.json`, `src/default-web-master-mode.ts`, and `GET`/`PUT /api/default-web-master-mode`. The advanced branch in [`extensions/chat/index.ts`](web-master/web-master/extensions/chat/index.ts) (`setModel`, `setThinkingLevel`, `sendUserMessage`, `waitForChatTurn`) goes with them. The chat the research path needs is Pi's own prompt, not a branch inside the command.

Run flags that stay, this run only: `--web-master-model`, `--web-master-provider`, `--web-master-effort`, `--web-master-prompt`, `--web-master-timeout`. Saves that stay, with no question: `--set-default-web-master-provider`, `--set-default-web-master-model`, `--set-default-web-master-effort`. `--help` still prints and stops. The "standard only" error goes away, because `/ask` is always that path.

Provider, model, and effort stay together in `default-web-master-model.json`. The launcher still reads `effort` and passes Pi `--thinking` for the process, which is what the research chat uses. `/ask` keeps applying effort on its own request.

## Publication

Hand-written `agent.json` in the web-master home, then the publisher fills `commands` and `tools` from `extensions/chat/index.ts` (export `HELP` the way image-describer exports it, so `/ask` and `/usage` help land in `CALLING.md`):

- `name`: `web-master`
- `launcher`: `pi-web-master`
- `defaultPrompt`: `/ask`
- `call`: `/ask <question>` so the generated cell is `pi-web-master -p "/ask <question>"`
- `purpose`: answers a delegated question, including one about the web, through `/ask`. Names the research exception in the same sentence, because this text is what the orchestrator sees on every turn. Also says not to call `/usage` unless the user asks about this agent's usage (fetch will otherwise add `Other commands: /usage`).
- `contract`: `~/pi-agents-experts-grouped/web-master/web-master/docs/CALLING.md`

`docs/CALLING.md` has a hand-written default section (both bash calls, when to use each, stdout/stderr) and a generated commands block. The publisher only walks `settings.json` `extensions`, not the `pi-web-access` package, so the generated tools section stays empty. The hand-written section says the unsashed chat uses `web_search`, `fetch_content`, and `get_search_content` itself. The caller sends the question and does not name a provider on those tools.

Copy [`scripts/publish.ts`](image-describer/image-describer/scripts/publish.ts) and add `"publish:agent"` to [`package.json`](web-master/web-master/package.json). Run it, then `npm run fetch:publications` in the orchestrator home.

## Orchestrator text that the table does not cover

The sentence above the generated table says to always send the slash command. That sentence wins over a softer line in `purpose` unless it names this exception: web-master is always `pi-web-master -p "/ask <question>"`, and a prompt with no `/ask` is allowed only when the user asked for advanced search, deep search, or research. The same sentence belongs in the orchestrator README's sibling section. The generated table itself stays the cheap call.

## Docs and tests

Update web-master `README.md`, `docs/CHEATSHEET.md`, `AGENTS.md`, and `APPEND_SYSTEM.md` so `/ask` is the direct call and a prompt with no slash is the chat. Drop the mode file from the tree and the API table. Adjust `test/args.test.ts`, `test/default-web-master-mode.test.ts` (remove), and the dashboard mode cases. Launcher check: `-p "/ask …"` unchanged, `-p "…"` unchanged, `-p "/usage --help"` unchanged.

No `ask` tool. The research chat is the turn; a tool that called `/ask` would start another provider call from inside it.
