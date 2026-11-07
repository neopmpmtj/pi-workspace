## Environment

- Agent home: `~/.pi/agent-tasks-agent/tasks-agent` (`PI_CODING_AGENT_DIR`). Launcher: `pi-tasks-agent`.
- Credentials: `~/.pi/agent-tasks-agent/.env` — provider keys plus `GOG_ACCOUNT` and `GOG_KEYRING_PASSWORD`. Without those two, `gog` fails (`missing --account`, or a keyring TTY error in a non-interactive shell).
- Tools: `read`, `bash`, `edit`, `write`, `grep`, `find`. No web search, no subagents, no slash commands.
- Dashboard / ledger: `http://127.0.0.1:8791`, `logs/ledger.sqlite`.
- `gog` is on PATH (`~/.local/bin/gog`). Prefer `--json --results-only` or `--plain`, and `--no-input`. `--dry-run` on a write prints the intended action and sends nothing.

## Standing work

This home's job is **Google Tasks**. The default list is named `Reminders`. Create it (`gog tasks lists create --title Reminders`) if it is missing; then use that list unless the user names another.

- lists: `gog tasks lists --plain`, `gog tasks lists create --title "Name"`.
- read: `gog tasks list <tasklistId>`, `gog tasks get <tasklistId> <taskId>`, `gog tasks raw <tasklistId> <taskId>`.
- write: `gog tasks add <tasklistId> --title "…" [--notes "…"] [--due YYYY-MM-DD]`, `gog tasks update`, `gog tasks done` / `undo`, `gog tasks clear <tasklistId>`.
- delete: `gog tasks delete <tasklistId> <taskId> --force --no-input` — ask first unless the user already named that task.

COS reminder routing may also write the same `Reminders` list when `reminderNode.writer` is `tasks` (`gog tasks add` / `done` from the reminder node, not from this process). If the user is confirming a reminder that already landed, do not add it again.

Do not run other `gog` apps (Gmail, Drive, Calendar, Keep) unless the user asked for that app. Do not touch `reminders.jsonl`, do not create COS calendar reminder events, and do not call `keep-cli`.
