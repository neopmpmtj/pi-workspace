## Environment

- Agent home: `~/pi-agents-experts-grouped/image-describer/image-describer` (own isolated workspace, not the main agent's).
- Credentials file: `~/pi-agents-experts-grouped/image-describer/.env`, beside the agent directory.
- Launch: `pi-image-describer` — an isolated launcher that sources only this agent's `.env`.
- Credentials: `DEEPSEEK_API_KEY` is required for the default model. `OPENAI_API_KEY` and `GEMINI_API_KEY` are optional additions to this same `.env` for gpt-6.1-sol and gemini-3.8-flash. Do not read the main agent's `.env`.
- Command: `/describe-images --dir <directory>`. The same pipeline is the `describe_images` tool.
- Tools: read, grep, find, ls, and describe_images. No bash, write, or edit.
- Extension: `extensions/describe-images`. No npm packages beyond this extension's own dependencies, no skills, no subagents, no cron, no web search.
