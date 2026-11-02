## Environment

- Agent home: `~/.pi/agent-web-master/web-master` (own isolated workspace, not the main agent's).
- Credentials file: `~/.pi/agent-web-master/.env`, beside the agent directory. `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, and `GEMINI_API_KEY` are all there. Do not read the main agent's `.env`.
- Launch: `pi-web-master` — an isolated launcher that sources only this agent's `.env`, reads `default-web-master-model.json` for the provider, model, and effort, and starts Pi with no built-in tools.
- Providers and models: `deepseek` (deepseek-flash, deepseek-v4-pro), `openai` (gpt-5.4, gpt-5.4-mini), `google` (gemini-3.8-flash, gemini-3.7-flash).
- Command: `/ask "<question>"` sends one request straight to the chosen provider, with no chat model turn. A prompt that does not start with `/ask` is a chat turn, which loads this file and can use the web tools. `/ask --help` lists the flags.
- Tools: `web_search`, `fetch_content`, and `get_search_content`, from the pinned `pi-web-access` package (`dist/index.js`). No bash, read, write, edit, skills, subagents, or cron.
- Web search: `web-search.json` in the agent home routes Brave → keyless Exa → DuckDuckGo, with `workflow: none`. `BRAVE_API_KEY` and `PERPLEXITY_API_KEY` are optional additions to this same `.env`. Do not pass a `provider` argument to the search tools.
- Ledger: `logs/ledger.sqlite`. Rate card: `model-rates.json`, beside `.env`.
