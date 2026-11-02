# sm-google-workspace

Section manager for Google Workspace. Tools are Pi's defaults — read, bash, edit, and write — plus find and grep. Google apps are reached with `gog` from bash. Three providers (DeepSeek, OpenAI, Gemini), and an exact record of where the tokens went, per run.

## Layout

```
~/.pi/agent-gog-workspace-agents/sm-google-workspace/   repo root: .env, rate card
└── sm-google-workspace/                                                 Pi agent home (PI_CODING_AGENT_DIR)
    ├── default-model.json    provider + model + thinking
    ├── extensions/chat/      the /ask and /usage commands
    ├── ledger/               models, providers, tokens, rates, store, runs
    ├── src/                  agent-specific glue
    └── logs/ledger.sqlite    the ledger itself
```

Launch with `pi-sm-google-workspace`. That launcher loads only this repo's `.env`.

## Use

```bash
pi-sm-google-workspace                                      # chat in the TUI
pi-sm-google-workspace -p "List unread mail from today"     # one turn, print mode
pi-sm-google-workspace -p '/gdrive-root'                    # canned: no model turn, no tokens
pi-sm-google-workspace -p '/inbox-new --hours 6'
pi-sm-google-workspace -p '/ask "List unread mail from today"'
```

Two paths, and only one of them reaches Google. A plain-language prompt starts a chat turn, so
the agent can run `gog`. `/ask` starts no chat turn and has no tools — it answers from the
model's memory, which is right for text work and wrong for anything about the account.

`/ask` writes the answer to stdout and the token/cost line to stderr, so it pipes:

```bash
pi-sm-google-workspace -p '/ask "List unread mail from today" --model gpt-6.1-sol --effort high' > answer.txt
```

Flags: `--model`, `--provider`, `--effort` (`off`, `default`, `minimal`, `low`, `medium`,
`high`, `xhigh`, `max`), `--timeout` (seconds), and the save flags
`--set-default-provider`, `--set-default-model`, `--set-default-effort`. A model named on
the command line brings no provider with it; the provider is inferred from the model.

Pi patches `console` to write to stderr in print mode, so the answer is written to file
descriptor 1 directly. A failure prints `[FAIL] <reason>` on stderr, records a failed row with
zero tokens, and exits non-zero so a script can branch on it:

```bash
pi-sm-google-workspace -p '/ask "…"' > answer.txt || echo "ask failed" >&2
```

The exit code is set with `process.exitCode` rather than `process.exit`, so Pi still finishes
writing the session file before the process ends.

## Fast path

Two questions are asked often enough to skip the model entirely. `/gdrive-root` and
`/inbox-new` run one fixed `gog` command, shape the JSON, and print tab-separated rows: no chat
turn, no tokens, about a second.

```bash
pi-sm-google-workspace -p '/gdrive-root'          # <name>\t<folder|file>\t<id>\t<modified>
pi-sm-google-workspace -p '/inbox-new --hours 6'  # <date>\t<from>\t<subject>\t<id>
```

`nothing found` when the list is empty. Anything needing judgement is a chat turn instead.

## Google apps

`gog` covers Gmail, Calendar, Chat, Classroom, Drive, Contacts, Tasks, Sheets, Docs, Slides, People, Forms, Meet, Apps Script, Analytics, Search Console, Groups, Admin, Keep, YouTube, Maps, Photos, and Sites.

```bash
gog gmail search 'is:unread newer_than:1d' --json --results-only
gog calendar calendars --json --results-only
gog drive search report --json --results-only
```

`gog <command> --help` and `gog schema <command>` describe the flags. `--json` or `--plain`, and `--no-input`, keep a run from stopping on a prompt.

## Usage

```bash
pi-sm-google-workspace -p '/usage'            # the last run, every call in it
pi-sm-google-workspace -p '/usage --all'      # totals per provider and model
pi-sm-google-workspace -p '/usage --session'  # this session only
pi-sm-google-workspace -p '/usage 7f3e'       # a run by id prefix
```

One line per paid call, then the run total. `est` is our rate card; `pi` is Pi's own figure
for the same call, which exists only for chat turns.

## The ledger

`logs/ledger.sqlite`, three tables: `runs` (one per input), `calls` (one per paid request),
`session_files` (bytes already read per session file).

- **Channel 1 — `command`** is written by the extension: `/ask` goes through Pi's model
  registry, so the catalog, credentials and pricing are the same as a chat turn, but no chat
  turn is started. Pi never sees the request, so `pi` is null on those rows.
- **Channel 2 — `chat`** is written by reading `sessions/**/*.jsonl`. Each assistant message
  carries `usage` and `durationMs`, so nothing is inferred. Only new bytes are read, and
  repeated call ids are ignored, so re-reading is safe.
- Both channels land in the same run: an `/ask` that was the opening message of a new session
  is folded into the run of that user entry, using `details.runId` and `parentId` from the
  session file rather than a time window.

The ledger is derived data and carries a `user_version`. A version change empties it rather
than migrating: sessions rebuild the chat side, and the next command rewrites its own row.

`pi-sm-google-workspace` reads `default-model.json` at startup and passes `--provider`, `--model`, and
`--thinking` to Pi. It applies to the next launch, not a running session. Without the file,
`settings.json` decides. `/ask` uses `default-model.json` when it exists, and otherwise
`settings.json` (`defaultProvider`, `defaultModel`, `defaultThinkingLevel`).

## Measurement

Two things are recorded, and they are not the same:

- **tokens** — reported by the provider, exact, kept forever.
- **cost** — tokens multiplied by `model-rates.json`. An estimate, recomputed on read,
  never frozen into a row. Change a rate and the whole history re-prices itself.

Pi's own per-turn cost is stored beside our estimate as a cross-check; a lasting gap
between the two means the cached provider catalog has gone stale.
