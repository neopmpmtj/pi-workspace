# Runbook — terminal toggles for the ~/.pi control plane (`pi-config`)

Written 2026-11-07, after the identity/config features landed as commits `639612c`,
`ba27f16` and `4859238` (inputPhrase, promptBuild, project dashboard on :8786).

## What was in place

| Surface | Where | Covers |
| --- | --- | --- |
| Web | `http://127.0.0.1:8786/settings` (`~/.pi/control/server.ts` + `public/`) | every gate in `config.json`, `inputPhrase`, `promptBuild`, each agent's `settings.json` / `default-model.json`, dashboard start/stop |
| HTTP API | `GET /api/settings`, `PUT /api/settings/gates/<name>`, `PUT /api/settings/input-phrase`, `PUT /api/settings/prompt-build`, `PUT /api/settings/agents/<id>` | same, scriptable with `curl` **but only while the server runs** |
| Validation | `~/.pi/control/store.ts` — `writeGate`, `writeInputPhrase`, `writePromptBuild`, `writeAgentSettings` | rejects bad values before a file is replaced; writes are temp-file + `rename` |
| Slash commands | `/ask`, `/usage`, `/cron`, `/archive`, `/sync`, `/reminders`, `/reminder-done`, `/reminder-undo`, `/calendar-undo`, `/jev-wrong`, `/commit` | **no** config toggles — none of the above values |

So before this runbook there was **no terminal path** at all: the only ways to flip a gate were
the browser, a `curl` against the running server, or hand-editing JSON (which silently does the
wrong thing — e.g. `inputPhrase` enabled with two options on prints a conflict in chat and
appends nothing, and `lessThanInputWords.words: 0` turns the gate off without a word).

## What was added

| File | Role |
| --- | --- |
| `~/.pi/control/cli.ts` | the CLI: `list`, `get`, `set`, `use`, `help`; imports `store.ts`, so validation is literally the same code as the web page |
| `~/.pi/control/cli.test.ts` | 7 tests, no network: writes, refusals, `--dry-run`, `--root` fixtures |
| `~/.local/bin/pi-config` | launcher; pins node to `~/.nvm/versions/node/v24.21.0` (`PI_NODE_BIN` overrides) and runs the CLI with `--experimental-strip-types` |

No server, no port, no credentials: `pi-config` reads and writes the same files the dashboard
does, and works when the dashboard is down.

The folder was `~/.pi/dashboard/` and was renamed `~/.pi/control/` on 2026-11-07: it holds the
store, the CLI, the agent process control and the web page, and only the web page is a
dashboard. `server.ts` + `public/` stay the web surface, unchanged on :8786.

## Running the web page

There is no systemd unit for the project dashboard; it is started by hand and detached:

```bash
cd ~/.pi && setsid nohup /home/pmpmt/.nvm/versions/node/v24.21.0/bin/node \
  --experimental-strip-types control/server.ts > ~/.cache/pi-project-dashboard.log 2>&1 < /dev/null &
```

One polling server per port: check `ss -tlnp | grep 8786` before starting another.

## Commands

```bash
pi-config list [--json]              # every value, grouped by file
pi-config get <path> [--json]        # one value; objects print as JSON
pi-config set <path> <value...>      # one write, validated
pi-config use <section>.<option>     # exactly-one-option groups, in a single write
pi-config help
```

Flags: `--json` (machine output), `--dry-run` (print the value and the payload, write nothing),
`--root <dir>` (another `~/.pi`-shaped tree; used by the tests).

A write re-serializes the whole file with two-space indentation — the same serializer the web
page uses. Values are unchanged, but the git diff can look wide the first time a compact file is
written (that is how `prompt-build-config.json` was committed: one line per option).

Exit code 0 on success, 1 on a rejected value. Rejections print `[FAIL] <store message>` on
stderr and change no file.

### The paths

```text
config.json        gates (one set of screens per hook)
  lessThanInputWords.{enabled,words,print}
  inputContainsPath.{enabled,print}
  inputContainsUrl.{enabled,print}
  inputContainsEmail.{enabled,print}
  calendarNode.{enabled,print,mode}        mode: route | dry
  reminderNode.{enabled,print,mode,writes} writes:false = route nothing, leave the turn to the model

agent-modes-config.json
  inputPhrase.enabled
  inputPhrase.append1                      appended to every typed message while on
  inputPhrase.<normal|advanced>.enabled    exactly one of the two
  inputPhrase.<normal|advanced>.allowBlank
  inputPhrase.<normal|advanced>.phrase

prompt-build-config.json
  promptBuild.enabled
  promptBuild.<personal|option1..option4>.enabled   exactly one
  promptBuild.<personal|option1..option4>.prompt
  promptBuild.<personal|option1..option4>.config    a JSON object, stored as an object

agent.<id>.{provider,model,thinking,tools,enabledModels,extensions,packages}
  <id>: cos | image-describer | web-master | keep | google-workspace
  model/thinking land in default-model.json when it exists, else in settings.json
```

Value forms: booleans `true|false|on|off|yes|no|1|0`; `tools`/`enabledModels` a comma list;
`extensions` a JSON array of `"+path"`/`"-path"` (or `{path, enabled}`);
`packages` a JSON array of names or `{kind, value, extensions}`; everything else a string, and
the remaining words are joined — quoting is optional.

### Why `use` exists

`inputPhrase` and `promptBuild` must have **exactly one** option on while their section is on,
so swapping the on option with two `set` writes fails in the middle (zero options on, or two).
`pi-config use inputPhrase.normal` (or `promptBuild option3`) is one write that turns the chosen
option on and the rest off.

## Examples

```bash
pi-config set inputPhrase.enabled off                # stop appending to every message
pi-config use inputPhrase.normal                     # switch phrase sets in one write
pi-config set inputPhrase.normal.phrase "answer in one sentence"
pi-config set promptBuild.option2.prompt "be brief"
pi-config set promptBuild.option2.config '{"tone":"warm"}'
pi-config use promptBuild personal
pi-config set calendarNode.mode dry                  # classify and trace, write nothing
pi-config set reminderNode.writes off                # no reminders.jsonl row, no event
pi-config set lessThanInputWords.words 12
pi-config set agent.cos.thinking high
pi-config set agent.cos.tools "read,bash,edit,write,grep,find"
pi-config get agent.cos.model
pi-config list --json | jq '.gates[] | {name, fields}'
```

When a value applies: gates, `inputPhrase` and `promptBuild` are read on the next message;
an agent's `settings.json` / `default-model.json` on that agent's next start.

## Tests

```bash
cd ~/.pi/agent/cos-orchestrator-agent && npm run test:dashboard    # 11 tests: store + cli
cd ~/.pi/control && node --experimental-strip-types --test '*.test.ts'   # the same, by hand
```

## Not covered by either surface (found in the same sweep)

- `~/.pi/cron/jobs.json` — `/cron` inside a chat is the only editor; `pi -p "/cron list"` from a
  shell is the terminal path. No `pi-config` path, deliberately (the scheduler owns the file).
- `telegram.json` (bot token / polling owner) and `.env` — secrets, no toggle.
- Dashboard **process** start/stop: the web page can do it; from a shell it is
  `cd <agent home> && npm run dashboard`, or `systemctl --user start pi-keep-agent-dashboard`.

## Sweep findings and what was done about them (2026-11-07)

1. **Port 8788 was claimed twice** — `control/agents.ts` gives it to image-describer, while
   `pi-keep-agent-dashboard.service` pinned keep-agent to it. Fixed: the unit now sets
   `DASHBOARD_PORT=8790` (plus Description and `DASHBOARD_ORIGIN`), keep-agent's `.env`
   matches, `daemon-reload` + restart done; keep-agent's `docs/CALLING.md` and `agent.json`
   updated and the roster republished (`npm run fetch:publications` here). Verified: 8790
   serving, 8788 free.
2. **Two project dashboard servers** — pid 275502 held :8786, pid 271193 held no port. Fixed:
   the inert one was killed.
3. **The project dashboard folder was outside every typecheck** — it was not under the agent
   home's `include`, and `store.ts` had four strict `TS7053` errors. Fixed: `control/tsconfig.json` (module
   ESNext, resolution Bundler, strict), two `Record<string, unknown>` annotations in
   `store.ts`, and `npm run typecheck` in the agent home now runs both projects. Dashboard
   tests have their own script: `npm run test:dashboard`.
4. **A scaffold under the grouped root was published as a sibling** —
   `agent-template-new-agent/template-new-agent` carries a copy of keep-agent's `agent.json`,
   so the roster grew a second keep-agent row pointing at `pi-keep-agent`. Fixed: a manifest
   with `"publish": false` is skipped by `scripts/fetch-publications.ts` (tested), and the
   scaffold sets it. A future scaffold should carry the same line.
5. **Formatting of written files** — a write re-serializes the whole file with two-space
   indentation (the web page's own serializer). `prompt-build-config.json` was committed with
   one line per option, so the first write produced a wide diff; it has been rewritten
   canonically once, and later writes change single lines.
