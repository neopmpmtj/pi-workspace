## Environment

- Agent home: `~/.pi/image-describer` (own isolated workspace, not the main agent's).
- Launch: `pi-image-describer` — an isolated launcher that sources only this agent's `.env`.
- Credentials: `DEEPSEEK_API_KEY` only. No Gemini, OpenAI, or Google access.
- Tools: read, grep, find, ls — read-only. No bash, write, or edit.
- No extensions, no npm packages, no skills, no subagents, no cron, no web search.
