# web-master

A chat agent for Pi with a ledger. Three chat providers, one web-search package, and an exact
record of where the money went — chat tokens and web searches, per run.

Built as the foundation for later agents: `ledger/` is self-contained and reusable.

## Status

Phases 1–3 done and in use: `/ask`, ingested chat turns, the time series, next-launch
settings, and web search with its own meter.

- **Chat** is measured from Pi's session files (exact tokens, Pi's own cost).
- **Web search** comes from `pi-web-access@0.44.0` (pinned, see `docs/DEPENDENCIES.md`):
  Brave → keyless Exa → DuckDuckGo, `workflow: "none"`. Searches are metered per query from
  the same session files, priced by `tool-rates.json`.

## Layout

```
~/.pi/agent-web-master/                 repo root: .env, rate card, docs
└── web-master/               Pi agent home (PI_CODING_AGENT_DIR)
    ├── default-web-master-model.json    provider + model + effort; written by the dashboard
    ├── web-search.json       search route: brave → exa → duckduckgo
    ├── extensions/chat/      the /ask and /usage commands
    ├── ledger/               reusable: models, providers, tokens, rates, store, runs,
    │                         and the tool meter (tool-rates, tool-store, search-ingest)
    ├── src/                  agent-specific glue
    ├── dashboard/            local API + web UI
    ├── docs/                 CHEATSHEET.md, DEPENDENCIES.md
    └── logs/ledger.sqlite    the ledger itself (chat calls + tool calls)
```

## Use

```bash
pi-web-master                                            # chat in the TUI
pi-web-master -p '/ask "What is a vector database?"'      # web lookup, then one provider call
pi-web-master -p "What is the current Node.js LTS?"       # chat turn, web tools
pi-web-master -p "/ask --help"                            # flag list
```

A message that starts with `/` is a slash command. Any other `-p` message is a chat turn. The launcher does not insert `/ask`.

`/ask` writes the answer to stdout and the token/cost line to stderr, so it pipes:

```bash
pi-web-master -p '/ask "Summarise CAP theorem" --web-master-model gpt-5.4 --web-master-effort high' > answer.txt
```

Run flags: `--web-master-model`, `--web-master-provider`,
`--web-master-effort` (`off`, `default`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`),
`--web-master-prompt`, `--web-master-timeout` (seconds). Save flags:
`--set-default-web-master-provider`, `--set-default-web-master-model`,
`--set-default-web-master-effort`. A model named on the command line brings no provider with it;
the provider is inferred from the model. `/ask --help` and `/usage --help` print the flags and stop.

`/ask` looks the question up on the configured web route, then makes one provider call. It does not load the bootstrap files. A prompt with no slash starts a chat turn, loads the bootstrap files, and can use web search itself. Use that prompt when the question is an advanced search, a deep search, or research.

Pi patches `console` to write to stderr in print mode, so the answer is written to file
descriptor 1 directly. A failure prints `[FAIL] <reason>` on stderr, records a failed row with
zero tokens, and **exits non-zero** so a script can branch on it:

```bash
pi-web-master -p '/ask "…"' > answer.txt || echo "ask failed" >&2
```

The exit code is set with `process.exitCode` rather than `process.exit`, so Pi still finishes
writing the session file before the process ends.

## Usage

```bash
pi-web-master -p '/usage'                 # the last run, every call in it
pi-web-master -p '/usage --usage-totals'  # totals per provider and model
pi-web-master -p '/usage --this-session'  # this session only
pi-web-master -p '/usage 7f3e'            # a run by id prefix
pi-web-master -p '/usage --help'
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

## Web access

`pi-web-access` adds three tools: `web_search`, `fetch_content`, `get_search_content`.

```bash
pi-web-master -p "What is the current Node.js LTS version?"
```

- Route: **Brave** (needs `BRAVE_API_KEY`) → **keyless Exa MCP** → **DuckDuckGo** (free).
  With no keys at all it still works, through Exa.
- `workflow: "none"` — no curator, no summary model, nothing summarised behind your back.
- Keys go in `~/.pi/agent-web-master/.env` (see `.env.example`).

### Changing the search order

Two ways, same file underneath. **In the dashboard** — Settings → *Web search* — the route is a
numbered list with ↑ ↓ ×, a provider picker, a workflow selector and a save button; each entry
shows whether it has a key (`no key`, `keyless MCP`, `key`, `free, explicit only`). **Or edit
`web-master/web-search.json` directly** — it is read on every search, so no restart:

```json
{
  "workflow": "none",
  "searchRouting": {
    "providers": ["brave", "exa", "perplexity", "duckduckgo"],
    "fallbackOn": ["transient", "quota", "network", "invalid-response"]
  }
}
```

1. **Edit `providers`**, left to right = first choice to last.
2. **Only list providers you can afford**, because with no key for the earlier ones the next
   one becomes the working default. Today `brave` has no key and `exa` is keyless and free, so
   Exa answers every search; the moment `BRAVE_API_KEY` exists, Brave takes over.
3. **`fallbackOn`** decides *when* it moves down the list: `transient`, `quota`, `network`,
   `invalid-response`. A provider that is simply unconfigured is skipped regardless.
4. **A new provider needs a price**, or its searches read `unrated`. Add it to
   `tool-rates.json` under `providers` (per search, USD).
5. **Changing the model or effort is separate** — that is `default-web-master-model.json`, written
   by the dashboard.

**Check what actually answered**: run a search, then

```bash
pi-web-master -p '/usage --web-search'
```

Each row carries the provider per query (`exa×1`, `perplexity×1` …), taken from the session's
`queryProviders`, so the ledger tells you which rung of the route served the call.

## Tool ledger

A search is a second kind of spend, so it gets its own table — `tool_calls`, created additively
in the same `ledger.sqlite` (the chat schema and its version never move).

Pi already writes every tool result into the session, including `queryCount` and the provider
per query, so the meter **reads sessions** instead of instrumenting the package: past searches
are backfilled, nothing is lost across restarts, and no extension hooks the tool loop.

```
$ pi-web-master -p '/usage --web-search'
exa             1 searches ·   0 urls · est $0.000000 · last 2026-10-27 10:24:07
— 1 tool calls · est $0.000000
```

Prices come from `tool-rates.json` (template `tool-rates.example.json`). Each row is
`rated`, `unrated` (the card has no price for that provider) or `partial` (the provider also
bills model tokens the session never sees, e.g. Gemini grounding or OpenAI web search). An
unknown provider is never shown as free.

## Dashboard

```bash
cd ~/.pi/agent-web-master/web-master && npm run dashboard     # http://127.0.0.1:8789
```

One process serves both the API and the page: no Vite, no second install, no CORS setup.
The agent home is the folder above `dashboard/`, so an unrelated `PI_CODING_AGENT_DIR` in the
shell cannot point it at the wrong ledger; `DASHBOARD_ROOT`, `DASHBOARD_PORT` and
`DASHBOARD_HOST` override that.

- **#metrics** (the default view): tokens or estimated cost per day, stacked by provider and
  model, then totals per model, then one row per run. Click a run to see every call it paid
  for. It refreshes itself over server-sent events when the ledger changes.
- **settings**: provider, model and effort, written to `default-web-master-model.json`. Those apply to the
  next launch, not the running session. Models come from Pi's cached catalog, so a value the
  catalog does not know cannot be saved.

Costs come from `model-rates.json` beside `.env` (template `model-rates.example.json`), and
fall back to Pi's catalog prices when that file is missing or malformed. Every row keeps the
rate version it was recorded under, while the displayed figure is recomputed with the current
card — edit the card and the whole history re-prices itself.

Provider switching is a file, read at launch:

```json
{ "provider": "google", "model": "gemini-3.8-flash", "effort": "low" }
```

`default-web-master-model.json` applies to the next launch, not the running session.

### Troubleshooting

The page and API share `127.0.0.1:8789`. Port 8787 is the orchestrator dashboard and 8788 is the image describer API.

See what is already bound to 8789:

```bash
pgrep -af "dashboard/server.ts|npm run dashboard"
ss -ltnp | grep 8789
```

Stop it. One process serves both the page and the API, so both lines are the same server. Killing only `npm` can leave Node listening:

```bash
pkill -f "dashboard/server.ts"
pkill -f "npm run dashboard"
```

## Measurement

Two things are recorded, and they are not the same:

- **tokens** — reported by the provider, exact, kept forever.
- **cost** — tokens multiplied by `model-rates.json`. An estimate, recomputed on read,
  never frozen into a row. Change a rate and the whole history re-prices itself.

Pi's own per-turn cost is stored beside our estimate as a cross-check; a lasting gap
between the two means the cached provider catalog has gone stale.
