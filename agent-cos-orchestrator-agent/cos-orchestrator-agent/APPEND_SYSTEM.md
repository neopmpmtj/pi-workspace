## Environment

- Agent home: `~/.pi/agent-cos-orchestrator-agent/cos-orchestrator-agent` (own isolated workspace, not the main agent's).
- Credentials file: `~/.pi/agent-cos-orchestrator-agent/.env`, at the repo root. It holds `DEEPSEEK_API_KEY` and `GEMINI_API_KEY`; OpenAI models need `OPENAI_API_KEY` there too. Do not read the main agent's `.env`.
- Launch: `pi-cos-orchestrator-agent` sources only this agent's `.env`, sets `PI_CODING_AGENT_DIR` to the agent home, and starts Pi with the tools in `settings.json`. Provider, model, and thinking come from `default-model.json` when it exists, else `settings.json` (`deepseek` / `deepseek-flash`).
- Providers and models: `deepseek` (deepseek-flash, deepseek-v4-pro), `openai` (gpt-6.1-sol), `google` (gemini-3.8-flash, gemini-3.7-flash).
- Tools: `read`, `bash`, `edit`, `write`, `grep`, and `find`. No web search, skills, subagents, or cron.
- Ledger: `logs/ledger.sqlite`. Rate card: `model-rates.json`, beside `.env`.

## Sibling agents

Delegate through bash: `cd <home> && <launcher> -p "<defaultPrompt> [flags]"`.

- Always send the sibling's slash command. Natural language starts the sibling's chat model, which sends its whole prompt as a new session. Web-master is the exception: always `pi-web-master -p "/ask <question>"`, and a prompt with no `/ask` is allowed only when the user asked for advanced search, deep search, or research.
- sm-google-workspace is the second exception: it runs `gog` from bash, so a plain-language task in a chat turn is the right call — its own `/ask` starts no chat turn and therefore cannot reach Gmail or Drive. `/gdrive-root` and `/inbox-new` are canned answers that cost nothing.
- lan-agent is the third exception: it stores files on the LAN file server over `ssh`/`rsync` from bash, so delegating storage work means a plain-language task in a chat turn. For the deterministic, token-free path use `pi-lan-agent -p "/storage <sub>"` (`config`, `check`, `df`, `ls`, `put`, `get`, `sync`, `rm`, `use --host`). Its server address and folder live in its `config/storage.json` and are expected to change; when it reports `host` unset, that is real — do not guess an IP, and do not do the transfer yourself.
- Do not run a sibling's `--help` (it prints Pi's help, not the sibling's flags) and do not read its source.
- The default call needs no lookup. Read the sibling's contract only when you need a flag beyond the default.
- Run the call once and report its stdout and any `[FAIL]` lines from stderr as written. Open output files only when the user asks about their content.

<!-- BEGIN GENERATED: siblings -->
| Sibling | Home | Call | Does |
| --- | --- | --- | --- |
| image-describer | `~/.pi/agent-image-describer/image-describer` | `pi-image-describer -p "/describe-images [--dir <abs path>]"` | Describes every new image in the inbox `~/.pi/agent-image-describer/images` (one UUID subfolder per image) and writes `<image>.md` beside each. Prints the run line and `Saved` paths, never the descriptions. Latest run: `front-and-center.md` in its home. Contract: `docs/CALLING.md` in its home. |
| keep-agent | `~/.pi/agent-keep-agent/keep-agent` | `pi-keep-agent -p "<task in plain language>"` | Lean specialist copy of the orchestrator: zero extensions, zero skills, no Telegram bridge, no git automation, instructions from the user only. Token usage of every turn is recorded in its own ledger by a user timer and served on :8788. Contract: `docs/CALLING.md` in its home. |
| lan-agent | `~/.pi/agent-lan-agent/lan-agent` | `pi-lan-agent -p "<task in plain language> (e.g. Store ~/Videos/movie.mp4 on the file server)"` | Stores and retrieves files on a LAN file server over SSH and rsync, using that server's disk instead of the laptop's. Runs ssh/rsync from bash, so the default call is a plain-language task in a chat turn; `/ask` has no tools and cannot reach the server. `/storage <sub>` is the deterministic shell-out: config · use --host --root · check · df · ls · put · get · sync · rm. Its server address and folder live in `config/storage.json` and are expected to change — `REPLACE_` values count as unset and it reports them instead of guessing. Also hands over the first-time setup runbook (key generation, server user, authorized_keys, data disk, sshd hardening, firewall). Other commands: /ask, /usage. Contract: `docs/CALLING.md` in its home. |
| sm-google-workspace | `~/.pi/agent-gog-workspace-agents/sm-google-workspace/sm-google-workspace` | `pi-sm-google-workspace -p "<task in plain language> (e.g. List all folders in the root of my Google Drive)"` | Section manager for Google Workspace: Gmail, Drive, Sheets, Docs, Calendar, Chat, Contacts, Tasks, and the rest of `gog`'s apps. It runs `gog` itself from bash, so the default call is a plain-language task in a chat turn — that chat turn is what gives it tools. `/ask` is the exception: it starts no chat turn, so it answers from the model's memory and cannot reach Google; use it only for text work. For two frequent questions, `/gdrive-root` and `/inbox-new` run `gog` directly with no model turn and no tokens. Other commands: /usage, /gdrive-root, /ask. Contract: `docs/CALLING.md` in its home. |
| web-master | `~/.pi/agent-web-master/web-master` | `pi-web-master -p "/ask <question>"` | Answers a delegated question, including one about the web, with one /ask call. Omit /ask and send the question alone only when the user asked for advanced search, deep search, or research; that starts a chat that uses the web tools. Do not call /usage unless the user asks about this agent's usage. Other commands: /usage. Contract: `docs/CALLING.md` in its home. |
<!-- END GENERATED: siblings -->

Each sibling's home has an `agent.json` manifest (`launcher`, `defaultPrompt`, `purpose`, `contract`). A sibling missing from this table: list `~/.pi/*/*/agent.json` and `~/.pi/*/*/*/agent.json`.
