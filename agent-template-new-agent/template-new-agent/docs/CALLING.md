# Calling template-new-agent

This is a lean portable seed, not a live sibling. `"publish": false` keeps it off the COS
roster. COS creates new siblings from `agent/cos-orchestrator-agent` via
`skills/agent-creator/scripts/scaffold.ts`, not from this folder.

To insert this home as its own agent: copy and rename the container, pick a free
`DASHBOARD_PORT`, write a launcher, then either leave `publish: false` or add it to the roster
(`npm run fetch:publications` in COS, and `control/agents.ts` if it should appear on `:8786`).

| Item | Value |
| --- | --- |
| Home | `~/.pi/agent-template-new-agent/template-new-agent` (`PI_CODING_AGENT_DIR`) |
| Env | `~/.pi/agent-template-new-agent/.env` — provider keys, `DASHBOARD_PORT`, `DASHBOARD_ORIGIN` |
| Launcher | `pi-template-new-agent` (not installed; this seed is not launched) |
| Model | `deepseek` / `deepseek-flash` / thinking `high` (all from `settings.json`) |
| Instructions | `AGENTS.md` — "instructions come from the user" plus generic hygiene. `APPEND_SYSTEM.md` — **zero bytes, frozen** |
| Usage | `logs/ledger.sqlite`, filled from `sessions/` by ingest; dashboard default `http://127.0.0.1:8792` |

Ports in use are 8786 (control), 8787 (COS), 8788 (image-describer), 8789 (web-master), and 8791 (tasks). `:8790` is free and must not be reused for keep-agent. This seed stays on `:8792`. Override
with `DASHBOARD_PORT` when inserting.

## Call

This seed has no launcher on `PATH`. After you install one:

```bash
cd ~/.pi/agent-template-new-agent/template-new-agent && pi-template-new-agent -p "<task in plain language>"
```

There are no slash commands in this home: no `/ask`, `/usage`, `/cron`, `/archive`, `/commit`,
`/sync`, `/reminders`. A `-p` turn is the only way in. Per-run overrides: `--model`, `--thinking`.

## Usage tracking

- **Source of truth: `sessions/`.** Pi itself writes one JSONL per session.
- **Ingest:** `scripts/ingest.ts` reads those files with a per-file byte offset and writes runs
  into `logs/ledger.sqlite`. Run by hand; this seed has no systemd timer.

```bash
cd ~/.pi/agent-template-new-agent/template-new-agent && PI_CODING_AGENT_DIR=$PWD \
  node --experimental-strip-types scripts/ingest.ts
npm run dashboard   # http://127.0.0.1:8792 unless DASHBOARD_PORT is set
```

## What is gone, deliberately

| Removed | Why |
| --- | --- |
| Every extension (`extensions/`) | Calendar and reminder nodes share `~/.pi/config.json`, `~/.pi/decision-nodes/` and `reminders.jsonl` with the orchestrator and could double-write. Restore from COS, not from this home |
| Routing source (`src/calendar-node.ts`, `reminder-node.ts`, `jev-classify.ts`, `jev-feedback.ts`, `telegram-delivery.ts`, `input-contains-*.ts`, `less-than-input-words.ts`, `global-config.ts`) | Same double-write risk. This seed stays lean |
| `skills/` | Every `SKILL.md` was re-sent each turn. Instructions come from the user |
| Roster publication | `"publish": false` — the seed stays off the COS roster |

`APPEND_SYSTEM.md` being empty is the freeze. This home has no `fetch:publications` script
and neither publishes nor consumes a sibling roster.

## What still works

- `ledger/`, `dashboard/`, `scripts/ingest.ts`, `src/default-model.ts` — the usage stack, copied
  in this home so a new agent stays portable.
- `src/args.ts`, `ask.ts`, `usage.ts`, `effective.ts`, `prompt.ts`, `report.ts`,
  `session-command.ts`, `archive-command.ts` — slash-command parsers with no `extensions/` to
  register them. Kept so a chat extension can be added here without copying those files from COS.
- Tests: `npm test` (76 tests) — ledger, token, dashboard, `/ask` parsers, and model code.

## Verify it is still lean

```bash
cd ~/.pi/agent-template-new-agent/template-new-agent
ls extensions skills prompts bin 2>&1       # expect: four "No such file or directory"
ls src/calendar-node.ts src/jev-classify.ts src/global-config.ts 2>&1
                                            # expect: three "No such file or directory"
wc -c APPEND_SYSTEM.md                      # expect: 0
python3 -c "import json; print(json.load(open('agent.json'))['name'])"
                                            # expect: template-new-agent
```
