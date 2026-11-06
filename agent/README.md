# cos-orchestrator-agent

Chief of staff for Pi. Tools are Pi's defaults — read, bash, edit, and write — plus find and
grep. Bash calls other agents from the shell (for example `pi-image-describer`). Three
providers (DeepSeek, OpenAI, Gemini), and an exact record of where the tokens went, per run.

Built as the foundation for later agents: `ledger/` is self-contained and reusable.

## Status

Delegation to sibling agents works through their slash commands. Image-describer and
web-master are the siblings. `/ask`, `/usage`, ingested chat turns, and the dashboard work.

## Layout

```
~/.pi/agent/   repo root: .env, rate card, docs
└── cos-orchestrator-agent/                           Pi agent home (PI_CODING_AGENT_DIR)
    ├── default-model.json    provider + model + effort; written by the dashboard
    ├── extensions/chat/      the /ask command
    ├── ledger/               reusable: models, providers, tokens, rates, store, runs
    ├── src/                  agent-specific glue
    ├── dashboard/            local API + web UI
    └── logs/ledger.sqlite    the ledger itself
```

## Use

```bash
pi                                            # chat in the TUI
pi -p "What is a vector database?"             # one turn, print mode
pi -p '/ask "What is a vector database?"'      # one request, no chat turn
```

`/ask` writes the answer to stdout and the token/cost line to stderr, so it pipes:

```bash
pi -p '/ask "Summarise CAP theorem" --model gpt-6.1-sol --effort high' > answer.txt
```

Flags: `--model`, `--provider`, `--effort` (`off`, `default`, `minimal`, `low`, `medium`,
`high`, `xhigh`, `max`), `--timeout` (seconds), and the save flags
`--set-default-provider`, `--set-default-model`, `--set-default-effort`. A model named on
the command line brings no provider with it; the provider is inferred from the model.

Pi patches `console` to write to stderr in print mode, so the answer is written to file
descriptor 1 directly. A failure prints `[FAIL] <reason>` on stderr, records a failed row with
zero tokens, and **exits non-zero** so a script can branch on it:

```bash
pi -p '/ask "…"' > answer.txt || echo "ask failed" >&2
```

The exit code is set with `process.exitCode` rather than `process.exit`, so Pi still finishes
writing the session file before the process ends.

## Sibling agents

The COS delegates to sibling agents in `~/pi-agents-experts-grouped/` by running their
launcher with a slash command: `pi-image-describer -p "/describe-images"` starts no chat
turn in the sibling. Web-master is the exception: always `pi-web-master -p "/ask <question>"`,
and a prompt with no `/ask` is allowed only when the user asked for advanced search, deep
search, or research. sm-google-workspace is the second exception: it runs `gog` from bash, so
a plain-language task in a chat turn is the right call — its own `/ask` cannot reach Google.
The roster is the `Sibling agents` table in `APPEND_SYSTEM.md`.

Each sibling owns two files in its agent home:

- `agent.json` — `name`, `launcher`, `defaultPrompt`, `purpose`, `contract`, plus any paths a
  caller needs (for image-describer: `inbox`, `latestRun`).
- `docs/CALLING.md` — the flags and output contract, read only when the default call is not enough.

To add a sibling: add its folder with those two files (its `npm run publish:agent` writes the
`commands`, `tools`, and the generated block of `CALLING.md` from its code), then run
`npm run fetch:publications` in the agent home to rebuild the `APPEND_SYSTEM.md` table.

The scan accepts two layouts: `<group>/<home>/agent.json` and `<group>/<repo>/<home>/agent.json`,
where the repo root holds `.env` and the Pi home sits one level below it.

## Usage

```bash
pi -p '/usage'            # the last run, every call in it
pi -p '/usage --all'      # totals per provider and model
pi -p '/usage --session'  # this session only
pi -p '/usage 7f3e'       # a run by id prefix
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

## Dashboard

```bash
cd ~/.pi/agent/cos-orchestrator-agent && npm run dashboard     # http://127.0.0.1:8787
```

Port 8787 is this dashboard. The image describer API uses 8788.
One process serves both the API and the page: no Vite, no second install, no CORS setup.
The agent home is the folder above `dashboard/`, so an unrelated `PI_CODING_AGENT_DIR` in the
shell cannot point it at the wrong ledger; `DASHBOARD_ROOT`, `DASHBOARD_PORT` and
`DASHBOARD_HOST` override that.

- **#metrics** (the default view): tokens or estimated cost per day, stacked by provider and
  model, then totals per model, then one row per run. Click a run to see every call it paid
  for. It refreshes itself over server-sent events when the ledger changes.
- **settings**: provider, model and effort, written to `default-model.json`. Changing
  model or effort saves immediately. Changing provider waits until a model is chosen.
  The launcher passes them to Pi on the next launch; without the file, `settings.json`
  decides (`deepseek` / `deepseek-flash`). Models come from Pi's cached catalog, so a
  value the catalog does not know cannot be saved.

Costs come from `model-rates.json` beside `.env` (template `model-rates.example.json`), and
fall back to Pi's catalog prices when that file is missing or malformed. Every row keeps the
rate version it was recorded under, while the displayed figure is recomputed with the current
card — edit the card and the whole history re-prices itself.

The dashboard writes that switch as `default-model.json`:

```json
{ "provider": "google", "model": "gemini-3.8-flash", "thinking": "low" }
```

`pi` reads it at startup and passes `--provider`, `--model`, and
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
