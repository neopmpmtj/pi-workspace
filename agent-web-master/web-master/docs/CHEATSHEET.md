# web-master — cheatsheet

A plain chat agent on Pi with a token ledger. Two ways to spend money, one place to see it.

## Layout

```
~/.pi/agent-web-master/                    repo root · .env · model-rates.json · tool-rates.json · README
└── web-master/                  PI_CODING_AGENT_DIR
    ├── AGENTS.md                prompt (short on purpose: it is billed every turn)
    ├── APPEND_SYSTEM.md         environment notes
    ├── auth.json                three providers, all `$ENV` references
    ├── models-store.json        Pi's cached provider catalog (fallback prices)
    ├── settings.json            defaultTools: [], enabledModels, extension wiring
    ├── default-web-master-model.json       the switch: provider · model · effort  (written by the dashboard)
    ├── agent.json               sibling manifest: launcher, default call, purpose
    ├── web-search.json          search route and workflow for pi-web-access
    ├── npm/                     this agent's own installed packages (isolated)
    ├── extensions/chat/         /ask and /usage
    ├── ledger/                  reusable core: env · tokens · rate-table · rates · store · ingest · runs · labels
    │                            tool meter: tool-rates · tool-store · search-ingest
    ├── src/                     agent glue: args · effective · ask · default-model · prompt · report · usage · session-command
    ├── dashboard/               server.ts + public/{index.html,app.js,style.css}
    ├── docs/                    CHEATSHEET.md · CALLING.md · DEPENDENCIES.md
    ├── logs/ledger.sqlite       the ledger: chat calls + tool calls
    ├── sessions/                Pi's own session JSONL, grouped by working directory
    └── test/                    unit tests, no network
```

## Launch

```bash
pi-web-master                              # TUI
pi-web-master -p '/ask "your question"'    # web lookup, then one provider call
pi-web-master -p "your question"           # chat turn, web tools
pi-web-master -p "/ask --help"
cd ~/.pi/agent-web-master/web-master && npm run dashboard   # http://127.0.0.1:8789
```

`~/.local/bin/pi-web-master` sources **only** `~/.pi/agent-web-master/.env`, reads `default-web-master-model.json`,
and execs `pi --provider … --model … --thinking … --no-builtin-tools`. The switch applies to
the **next launch**.

A message that starts with `/` is a slash command. Any other `-p` message is a chat turn.
The launcher does not insert `/ask`.

## The two channels

| | How | Ledger origin | `pi` cost available? |
|---|---|---|---|
| **Chat** | you type in the TUI, or `-p` with a message that does not start with `/` | `chat` | yes — Pi records it |
| **/ask** | `/ask "…"` | `command` | no — Pi never sees the request |
| **both** | chat turn that also ran `/ask` | `mixed` | partial |

Chat turns are not instrumented: they are **read back** from `sessions/**/*.jsonl`, where Pi
already stores `usage` and `durationMs` per assistant message.

## /ask

```bash
/ask "What is a vector database?"
/ask --help
/ask "…" --web-master-model gpt-5.4 --web-master-effort high
/ask "…" --web-master-provider google --web-master-model gemini-3.8-flash --web-master-timeout 90
pi-web-master -p '/ask "…"'          # answer → stdout, cost line → stderr
pi-web-master -p "…"                 # chat turn, for advanced search, deep search, or research
```

| Flag | Meaning |
|---|---|
| `--help` | Print the flags and stop. No request, no file write. Other flags on the line are ignored |
| `--web-master-model <id>` | model id, or `provider/id`. The provider is inferred from the model |
| `--web-master-provider <id>` | `deepseek`, `openai`, `google`. Needs `--web-master-model` |
| `--web-master-effort <level>` | `off`, `default`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `--web-master-prompt <text>` | Replaces the `/ask` system prompt for this run. Does not write `prompts.json` |
| `--web-master-timeout <sec>` | Aborts the request; a failed row is still recorded |
| `--set-default-web-master-model` / `--set-default-web-master-provider` / `--set-default-web-master-effort` | write `default-web-master-model.json`, no request. Provider and model may be paired. Effort is alone |

The system prompt is fixed (`prompts.json` → `ask`, else a built-in default) and **identical
for all three providers**, so a comparison measures the model and not the instruction. `/ask`
is deliberately not a tool: a tool would let the model call another model and blur the
attribution.

`/ask` looks the question up on the configured web route, then makes one provider call with the `/ask` prompt. A prompt with no slash starts a chat turn, so
`AGENTS.md` and `APPEND_SYSTEM.md` load and the web tools are available. Use that prompt for
advanced search, deep search, or research.

A model named on the command line carries **no provider** with it — taking the saved provider
along would resolve `gpt-5.4` against the DeepSeek catalog. Same rule for the save flags.

## Exit codes (print mode)

Writing a script against `/ask` is the point, so a failure has to be visible in `$?`:

```bash
pi-web-master -p '/ask "…"' > answer.txt || echo "ask failed" >&2
```

Three ways to set that code, only one of which works:

| Approach | Result |
|---|---|
| `throw` from the handler | Pi catches it, prints `Extension error (command:ask): …`, and **still exits 0**. Unusable for scripts |
| `process.exit(1)` | exits 1, but kills the process before Pi finishes writing the session file |
| `process.exitCode = 1` | exits 1, stdout intact, session written — what the extension does |

The code is set only when `ctx.hasUI` is false, so a TUI session never inherits a non-zero
exit status.

A failed command is not silent even when nothing was billed. A parse error (`--nope`, a missing
value) writes the typed command line into the session and exits 1, so a typo appears in the
transcript instead of vanishing. A failed *request* additionally records a `calls` row with
`status = failed` and zero tokens.

## /usage

```bash
/usage                    # last run, every call in it
/usage --help
/usage --usage-totals     # totals per provider and model
/usage --this-session     # this session only
/usage 7f3e               # a run by id prefix
/usage --web-search       # web searches per provider, with cost
```

## Dashboard

One process serves the API and the page — no Vite, no second install, no CORS list. Two
hash-routed tabs: `#metrics` and `#settings`.

| Settings section | Writes | Applies |
| --- | --- | --- |
| **Model** — provider, model, effort | `default-web-master-model.json` | next launch |
| **Web search** — route order, workflow | `web-search.json` | next search |
| **Prices** — both cards, read-only, `unrated` flagged | — | — |

| Route | Returns |
|---|---|
| `GET /api/data` | calls, per-model totals, run list, rate card identity |
| `GET /api/settings` | current `default-web-master-model.json`, catalog models, effort levels |
| `PUT /api/settings` | validates against the catalog, writes `default-web-master-model.json` |
| `GET /api/events` | SSE; the page refetches when the ledger changes |

`#metrics` = time series (tokens or estimated cost, stacked by provider/model), per-model
totals, and a run table that expands into individual calls. Settings writes the next launch.

The root is the folder above `dashboard/`, not `PI_CODING_AGENT_DIR`, so a stray environment
variable cannot point it at the wrong ledger. `DASHBOARD_ROOT`, `DASHBOARD_PORT`,
`DASHBOARD_HOST`, `DASHBOARD_ORIGIN` override.

## The ledger

`logs/ledger.sqlite`, `PRAGMA user_version` pinned to `SCHEMA_VERSION`.

| Table | Holds |
|---|---|
| `runs` | one row per input: label, session, turn id |
| `calls` | one row per paid request: tokens, `cost_pi`, `rates_version`, status |
| `session_files` | bytes already ingested per session file |

**Ingest** reads each session file from its stored byte offset, so only new bytes are parsed.
A shorter file means truncation → re-read from zero. `call_id` is `<sessionId>/<entryId>`, and
inserts are `INSERT OR IGNORE`, so re-reading can never duplicate a row.

**Run identity** is exact, not heuristic: the extension's `custom_message` persists
`details.runId`, and its `parentId` points at the user entry. When an `/ask` was the opening
message of a new session, its command run is folded into that turn's run. Otherwise the
command run stands alone.

**Schema changes** empty the ledger rather than migrating. It is derived data: sessions rebuild
the chat side, and the next command rewrites its own row.

## Web access

`pi-web-access@0.44.0`, loaded from its built bundle (`+dist/index.js`), pinned — see
`DEPENDENCIES.md` for why and how to upgrade.

| | |
|---|---|
| Tools | `web_search`, `fetch_content`, `get_search_content` |
| Route | Brave → keyless Exa MCP → DuckDuckGo (`searchRouting`, `fallbackOn` typed failures) |
| Workflow | `none` — no curator, no summary model, raw results |
| Keys | `BRAVE_API_KEY`, `PERPLEXITY_API_KEY` optional in `~/.pi/agent-web-master/.env` |
| Isolation | `PI_CODING_AGENT_DIR` wins outright, so `web-search.json` and `web-search-cache/` stay in this agent |

Two rules the prompt enforces: **never pass `provider`** (it would bypass the metered route),
and prefer `{ queries: [...] }` with 2–4 angles over four separate calls.

### Changing the order

Dashboard → **Settings → Web search**: numbered list, ↑ ↓ ×, provider picker, workflow select,
save. Each row shows key state (`no key`, `keyless MCP`, `key`, `free, explicit only`).

Same thing by hand in `web-master/web-search.json` — read on every search, no restart:

```json
{
  "workflow": "none",
  "searchRouting": {
    "providers": ["brave", "exa", "perplexity", "duckduckgo"],
    "fallbackOn": ["transient", "quota", "network", "invalid-response"]
  }
}
```

- Left to right = first choice to last. The first provider that is **configured and answering**
  is the one you pay.
- An unconfigured provider (no key) is skipped silently. That is why Exa answers today: no
  `BRAVE_API_KEY` yet. With no keys at all, DuckDuckGo still answers.
- `fallbackOn` lists the failures that move down the list: `transient`, `quota`, `network`,
  `invalid-response`. Explicit-only providers such as `duckduckgo` are allowed here.
- Do not set `provider` beside `searchRouting`: a single-provider field wins and turns routing
  off.
- New provider means a new price: add `providers.<name>.perSearch` to
  `~/.pi/agent-web-master/tool-rates.json`, or every one of its searches reads `unrated`.

Verify which rung answered:

```bash
/usage --web-search     # providers per call, e.g. exa×1 or perplexity×1
```

## Tool ledger

A second table, `tool_calls`, created with `CREATE TABLE IF NOT EXISTS` in the same
`ledger.sqlite`. The chat schema and its `SCHEMA_VERSION` never move.

- **Source of truth is the session file**, not an event hook: a `toolResult` message carries
  `durationMs`, `queryCount`, `totalResults` and `queryProviders` (which provider answered each
  query). So past searches are backfilled and restarts lose nothing.
- **Its own byte offsets** (`tool_files`), independent of the chat ingest (`session_files`), so
  two passes over the same JSONL can't fight.
- **Cost is per query, not per call**: one `web_search` can carry up to three queries, and a
  query answered by two providers was billed twice.
- **Statuses**: `rated` (card priced it), `unrated` (no price for that provider — never shown as
  free), `partial` (the provider also bills model tokens that never reach the session).
- `get_search_content` is free and not recorded.
- Pricing lives in `tool-rates.json` beside `.env`, template `tool-rates.example.json`.

## Tokens are facts, cost is an opinion

Every call stores tokens plus `rates_version`; the dollar figure is **computed on read** from
`model-rates.json` using the entry in force at the call's timestamp.

- Fix a price → the whole history re-prices itself. Nothing to migrate, no wrong rows.
- The card supports `effectiveFrom`, so a price change is a new entry, not an edit.
- Missing or malformed card → falls back to Pi's catalog prices, and the dashboard says which
  source it used.
- `est` and `pi` side by side: a lasting gap between them means the cached catalog went stale.

```json
{ "effectiveFrom": "2026-01-01T00:00:00Z", "input": 2.5, "output": 15, "cacheRead": 0.25 }
```

Prices are dollars per million tokens. `input` excludes cache reads; `output` includes
reasoning; `total` = input + cacheRead + output.

## What a call records

`provider`, `model_requested`, `model_returned` (providers sometimes serve a different
snapshot), `effort_requested`, `effort_effective`, `input`, `cache_read`, `cache_write`,
`output`, `reasoning`, `total_tokens`, `duration_ms`, `cost_pi`, `rates_version`, `status`.

Never recorded: the answer, the prompt text beyond an 80-character run label, or any key.
Full transcripts stay in `sessions/`.

## Files that matter

| Path | Why |
|---|---|
| `~/.pi/agent-web-master/.env` | the three keys, mode 600 |
| `~/.pi/agent-web-master/model-rates.json` | our prices (gitignored; template `.example.json`) |
| `web-master/default-web-master-model.json` | what the launcher will use next |
| `web-master/agent.json` | what the orchestrator reads: launcher, `/ask` call, purpose |
| `web-master/logs/ledger.sqlite` | every call |
| `web-master/sessions/**/*.jsonl` | Pi's record, the source of channel 2 |

## Troubleshooting

| Symptom | Cause |
|---|---|
| `[FAIL] No API key configured for provider "x"` | key missing from `~/.pi/agent-web-master/.env` |
| `[FAIL] Unknown model "prov"` | the model is not in that provider's cached catalog |
| `[FAIL] table … has no column` | schema bumped; delete `logs/ledger.sqlite` |
| `[FAIL] Request aborted` | `--web-master-timeout` fired; a failed row with 0 tokens was written |
| `-p` output empty | print mode needs `fs.writeSync(1, …)`; Pi routes `console` to stderr |
| script cannot tell success from failure | in print mode a failure sets `process.exitCode = 1`; use `… \|\| echo failed` |
| chat turn missing from `/usage` | run `/usage` again (it syncs first), or check `sessions/` |
| search missing from `/usage --web-search` | the tool result must be in a session file; run `/usage` again to sync |
| `unrated` on a tool row | `tool-rates.json` has no entry for that provider — add one, don't guess |
| `partial` on a tool row | provider bills model tokens the session never records (Gemini, OpenAI) |
| dashboard exits with "already in use" | another copy is already bound to 8789; see below |

### Dashboard already running

One process serves the page and the API on `127.0.0.1:8789`. Port 8787 is the orchestrator and 8788 is the image describer API. See what is holding 8789:

```bash
pgrep -af "dashboard/server.ts|npm run dashboard"
ss -ltnp | grep 8789
```

`pgrep` lists the `npm run dashboard` parent and the Node process. `ss` shows which of them is listening. Stop both — killing only `npm` can leave Node on the port:

```bash
pkill -f "dashboard/server.ts"
pkill -f "npm run dashboard"
```

A second copy can use another port instead: `DASHBOARD_PORT=8790 npm run dashboard`.

## Design rules

1. One input is one run; both channels land in it.
2. Tokens are stored, dollars are derived.
3. Print mode: answer on stdout, cost on stderr, `[FAIL]` + exit code 1 on failure. Use
   `process.exitCode`, never `process.exit` — Pi must finish writing the session file.
4. No tools. A chat agent that can act is a different agent.
5. `ledger/` has no agent-specific code, so the next agent copies it unchanged.
6. Meter tools from the session file, never by wrapping the package: no fork to maintain, and
   history backfills itself.
7. A price we do not know is `unrated`, never `$0`.
