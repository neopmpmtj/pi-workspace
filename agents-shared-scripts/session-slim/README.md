# Session slim

`slim_session.py` turns a Pi session JSONL file into a shorter JSON file you can read through. The result keeps the conversation and the few records that say what the session did. It leaves out the system prompt, reasoning, tool traffic, and telemetry.

This folder, `~/.pi/agents-shared-scripts/session-slim/`, is the shared copy for every agent. Per-agent installs are not wired up yet.

Requires Python 3. No extra packages.

## Usage

```bash
# one file, by path
python3 ~/.pi/agents-shared-scripts/session-slim/slim_session.py /path/to/session.jsonl

# one file, by session id or filename (looks under ~/.pi/agent/sessions/)
python3 ~/.pi/agents-shared-scripts/session-slim/slim_session.py --session 01a02571-0db4-74bb-836a-17405724cce9
python3 ~/.pi/agents-shared-scripts/session-slim/slim_session.py --session 2026-08-21T17-49-21-204Z_01a02571-0db4-74bb-836a-17405724cce9.jsonl

# every .jsonl file under a directory, including subfolders
python3 ~/.pi/agents-shared-scripts/session-slim/slim_session.py ~/.pi/agent/sessions

# write somewhere else
python3 ~/.pi/agents-shared-scripts/session-slim/slim_session.py --out /tmp/slim ~/.pi/agent/sessions
```

`--session` and file paths cannot be used together. A unique prefix of a session id is enough. If a filename or id prefix matches more than one file, the script lists the paths and writes nothing.

## Output

Default directory: `~/.pi/sessions-slim/`. That directory is gitignored.

Each input `name.jsonl` becomes `name.json` in that one folder. Passing `~/.pi/agent/sessions` walks every project folder under it, including `archive.old`, and still writes a flat list. The project path is the `cwd` field on the first record, not a subfolder of the output.

An existing output file is overwritten.

The file is a JSON array. The first element is the original session record, unchanged:

```json
{
  "type": "session",
  "version": 3,
  "id": "01a02571-0db4-74bb-836a-17405724cce9",
  "timestamp": "2026-08-21T17:49:21.204Z",
  "cwd": "/home/pmpmt/python/260821-central_de_compras/warehouse_V2"
}
```

Later elements are the kept records, in the original order.

## Kept

| Record | What is written |
|---|---|
| First line | The whole session record (`type`, `version`, `id`, `timestamp`, `cwd`) |
| User message | `id`, `timestamp`, role, and every text block |
| Assistant message | `id`, `timestamp`, role, and non-blank text blocks |
| Assistant error | `errorMessage` when a turn has no text |
| `model_change` | `provider`, `modelId` |
| `session_info` | `name` |
| `compaction` | `summary` |
| `custom_message` | Text from `subagent_complete` and `curator-config` |
| `bashExecution` | The command |
| `context_edit` | Only when `replacement` has content |

## Dropped

- System messages, including the prompt sections and the tool list
- Assistant thinking, including `thinkingSignature`
- Tool calls and tool results, including diffs, search caches, and images
- `custom` records of type `web-search-results`
- `thinking_level_change`
- Telemetry: `usage`, `api`, `provider`, `model`, `responseId`, `stopReason`, `durationMs`, `thinkingLevel`, `parentId`
- Assistant turns that contain only thinking or tool calls
- Bash output

There is no separate memory or lessons field. That content survives only when it was written as user text, assistant text, a compaction summary, or a subagent report.
