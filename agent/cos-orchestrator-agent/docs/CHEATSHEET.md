# cos-orchestrator-agent — cheatsheet

Chief of staff on Pi. Tools are Pi's defaults (read, bash, edit, write) plus find and grep.
Bash calls other agent launchers. A token ledger still records where the money went.

## Layout

```
~/.pi/agent/   repo root · .env · model-rates.json · README
└── cos-orchestrator-agent/                           PI_CODING_AGENT_DIR
    ├── AGENTS.md                prompt (short on purpose: it is re-sent with every turn)
    ├── APPEND_SYSTEM.md         environment notes
    ├── auth.json                three providers, all `$ENV` references
    ├── models-store.json        Pi's cached provider catalog (fallback prices)
    ├── settings.json            defaultTools: read, bash, edit, write, grep, find
    ├── default-model.json       the switch: provider · model · thinking  (written by the dashboard)
    ├── extensions/chat/         /ask and /usage
    ├── ledger/                  reusable core: env · tokens · rate-table · rates · store · ingest · runs · labels
    ├── src/                     agent glue: args · effective · ask · default-model · prompt · report · usage · session-command
    ├── dashboard/               server.ts + public/{index.html,app.js,style.css}
    ├── logs/ledger.sqlite       the ledger
    ├── sessions/                Pi's own session JSONL, grouped by working directory
    └── test/                    254 tests, no network
```

## Launch

```bash
pi                       # TUI
pi -p "your question"    # one chat turn, print mode
cd ~/.pi/agent/cos-orchestrator-agent && npm run dashboard   # http://127.0.0.1:8787
```

`~/.local/bin/pi` sources **only** `~/.pi/agent/.env`,
sets `PI_CODING_AGENT_DIR` to the nested agent home, and execs `pi`. Tools come from
`settings.json` (`read`, `bash`, `edit`, `write`, `grep`, `find`). Provider, model, and thinking
come from `default-model.json` when it exists, else from `settings.json` (`deepseek` /
`deepseek-flash`).

## Settings from the terminal

The project dashboard edits the control plane at `http://127.0.0.1:8786/settings`.
The same values flip from a shell, with no server running:

```bash
pi-config list                  # gates · inputPhrase · promptBuild · agent settings, grouped
pi-config get agent.cos.model
pi-config set reminderNode.writes off
pi-config set modeSwitch.enabled off  # the hook above JEV: mode status and mode changes
pi-config set modeSwitch.answer hook # answer a mode request with no model turn at all
pi-config set inputPhrase.enabled on
pi-config use inputPhrase.normal     # the exactly-one-option groups swap in one write
pi-config set promptBuild.option2.config '{"tone":"warm"}'
pi-config set agent.cos.thinking high
```

`~/.pi/control/cli.ts` imports `~/.pi/control/store.ts`, so validation and the atomic
file replacement are the web page's own code. Runbooks:
`docs/runbooks/pi-config-terminal-toggles.md`, `docs/runbooks/mode-switch.md`.

## Sibling agents

| | |
|---|---|
| Call | `cd <home> && <launcher> -p "<defaultPrompt> [flags]"`, e.g. `pi-image-describer -p "/describe-images"`. Web-master is always `pi-web-master -p "/ask <question>"`. A prompt with no `/ask` is allowed only when the user asked for advanced search, deep search, or research. |
| Roster | `Sibling agents` table in `APPEND_SYSTEM.md` (re-sent with every turn, mostly at cached rates: one row per sibling) |
| Manifest | `<sibling home>/agent.json`: `name`, `launcher`, `defaultPrompt`, `purpose`, `contract` |
| Contract | `<sibling home>/docs/CALLING.md`, read only for non-default flags |
| Add one | folder + `agent.json` + `CALLING.md` (the sibling's `npm run publish:agent`), then `npm run fetch:publications` here |

## The two channels

| | How | Ledger origin | `pi` cost available? |
|---|---|---|---|
| **Chat** | you type, or `-p "…"` | `chat` | yes — Pi records it |
| **/ask** | `/ask "…"` | `command` | no — Pi never sees the request |
| **both** | chat turn that also ran `/ask` | `mixed` | partial |

Chat turns are not instrumented: they are **read back** from `sessions/**/*.jsonl`, where Pi
already stores `usage` and `durationMs` per assistant message.

## /ask

```bash
/ask "What is a vector database?"
/ask "…" --model gpt-6.1-sol --effort high
/ask "…" --provider google --model gemini-3.8-flash --timeout 90
pi -p '/ask "…"'          # answer → stdout, cost line → stderr
```

| Flag | Meaning |
|---|---|
| `--model <id>` | model id, or `provider/id`. The provider is inferred from the model |
| `--provider <id>` | `deepseek`, `openai`, `google`. Needs `--model` |
| `--effort <level>` | `off`, `default`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `--timeout <sec>` | aborts the request; a failed row is still recorded |
| `--set-default-model` / `--set-default-provider` / `--set-default-effort` | write `default-model.json`, no request made |

With no `--model` and no `default-model.json`, `/ask` uses `settings.json`
(`defaultProvider`, `defaultModel`, `defaultThinkingLevel`). `default-model.json` wins when both exist.

The system prompt is fixed (`prompts.json` → `ask`, else a built-in default) and **identical
for all three providers**, so a comparison measures the model and not the instruction. `/ask`
is deliberately not a tool: a tool would let the model call another model and blur the
attribution.

A model named on the command line carries **no provider** with it — taking the saved provider
along would resolve `gpt-6.1-sol` against the DeepSeek catalog. Same rule for the save flags.

## Exit codes (print mode)

Writing a script against `/ask` is the point, so a failure has to be visible in `$?`:

```bash
pi -p '/ask "…"' > answer.txt || echo "ask failed" >&2
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
/usage            # last run, every call in it
/usage --all      # totals per provider and model
/usage --session  # this session only
/usage 7f3e       # a run by id prefix
```

## Dashboard

One process serves the API and the page — no Vite, no second install, no CORS list.

| Route | Returns |
|---|---|
| `GET /api/data` | calls, per-model totals, run list, rate card identity |
| `GET /api/settings` | current `default-model.json`, catalog models, effort levels |
| `PUT /api/settings` | validates against the catalog, writes `default-model.json` |
| `GET /api/events` | SSE; the page refetches when the ledger changes |

`#metrics` = time series (tokens or estimated cost, stacked by provider/model), per-model
totals, and a run table that expands into individual calls. Changing model or effort writes
`default-model.json` for the next launch. Changing provider waits until a model is chosen.

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

## Prompt caching

- Pi reads `AGENTS.md` and `APPEND_SYSTEM.md` at startup and on `/reload` only. An edit
  mid-session does nothing until then.
- Every request still carries the full system prompt plus the whole conversation; the provider
  APIs keep no state between requests.
- The provider caches repeated prompt prefixes on its side. In recorded deepseek-flash sessions
  the cache read grows each turn (640, then 3,200, up to 8,448 tokens) while uncached input stays
  at about 150 to 400 tokens.
- Cache reads cost 2% of input for deepseek-flash, 10% for gemini-3.8-flash, and 5% for
  gpt-6.1-sol. The first turn of a session, a turn after the cache expires, and any text after a
  changed point are billed at the full input price.

## What a call records

`provider`, `model_requested`, `model_returned` (providers sometimes serve a different
snapshot), `effort_requested`, `effort_effective`, `input`, `cache_read`, `cache_write`,
`output`, `reasoning`, `total_tokens`, `duration_ms`, `cost_pi`, `rates_version`, `status`.

Never recorded: the answer, the prompt text beyond an 80-character run label, or any key.
Full transcripts stay in `sessions/`.

## Files that matter

| Path | Why |
|---|---|
| `~/.pi/agent/.env` | the three keys, mode 600 |
| `~/.pi/agent/model-rates.json` | our prices (gitignored; template `.example.json`) |
| `cos-orchestrator-agent/settings.json` | provider, model, and thinking used when `default-model.json` is absent, by the launcher and by `/ask` |
| `cos-orchestrator-agent/default-model.json` | written by the dashboard and `/ask --set-default-*`; read by the launcher and `/ask`, ahead of `settings.json` |
| `cos-orchestrator-agent/logs/ledger.sqlite` | every call |
| `cos-orchestrator-agent/sessions/**/*.jsonl` | Pi's record, the source of channel 2 |

## Troubleshooting

| Symptom | Cause |
|---|---|
| `[FAIL] No API key configured for provider "x"` | key missing from `~/.pi/agent/.env` |
| `[FAIL] Unknown model "prov"` | the model is not in that provider's cached catalog |
| `[FAIL] table … has no column` | schema bumped; delete `logs/ledger.sqlite` |
| `[FAIL] Request aborted` | `--timeout` fired; a failed row with 0 tokens was written |
| `-p` output empty | print mode needs `fs.writeSync(1, …)`; Pi routes `console` to stderr |
| script cannot tell success from failure | in print mode a failure sets `process.exitCode = 1`; use `… \|\| echo failed` |
| chat turn missing from `/usage` | run `/usage` again (it syncs first), or check `sessions/` |

## Design rules

1. One input is one run; both channels land in it.
2. Tokens are stored, dollars are derived.
3. Print mode: answer on stdout, cost on stderr, `[FAIL]` + exit code 1 on failure. Use
   `process.exitCode`, never `process.exit` — Pi must finish writing the session file.
4. Tools are read, bash, edit, write, grep, and find. Use bash to call other agent launchers. No web search.
5. `ledger/` has no agent-specific code, so the next agent copies it unchanged.
6. Extension `input` handlers run in **extension load order**, and pi's load order is directory
   enumeration (`readdirSync`), not the `extensions` array in `settings.json` (verified
   2026-11-07: zzz/aaa/mmm listed in that order loaded aaa/mmm/zzz). So a hook must never
   assume it runs before another one: put the bypass in the code they all share, the way
   `src/mode-switch.ts` does it inside `classifyPrompt`, and mark replacements (`src/mode-ack.ts`)
   instead of relying on position. `settings.json` order documents intent, nothing more.
