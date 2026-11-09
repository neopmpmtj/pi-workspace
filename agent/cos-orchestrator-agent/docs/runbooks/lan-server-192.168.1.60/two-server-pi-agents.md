# Runbook: two pi agents on the LAN server (192.168.1.60)

Built 2026-11-08. Two independent agents live on the server, side by side, each with its own
home, launcher, `.env`, SQLite ledger and `/ask` + `/usage` commands:

| Agent | Launcher | Model | Credentials | Memory |
| --- | --- | --- | --- | --- |
| `cloud` | `pi-cloud` | `deepseek/deepseek-flash` (default), plus `deepseek-v4-pro`, `openai/gpt-6.1-sol`, `google/gemini-3.8-flash`, `gemini-3.7-flash` | `~/.pi/agent-cloud/.env` — copies of the laptop's `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` | paid, metered in its own ledger |
| `ollama` | `pi-ollama` | `ollama/gemma4:12b` (default), plus `qwen3.5:9b`, `qwen2.5vl:7b` | none — dummy key `ollama` in `models.json`, endpoint on loopback | RTX 3060, 16K ctx, $0 |

Both are **additive**: the pre-existing `~/.pi/agent` home on the server (pi installed 2025-11-03,
API keys in `.env`) is untouched and still works.

## Layout on the server

```
~/.pi/agent-cloud/{.env,.gitignore}           container: keys, 0600
~/.pi/agent-cloud/cloud/                      PI_CODING_AGENT_DIR
    agent.json AGENTS.md settings.json default-model.json models.json(no) package.json tsconfig.json
    ledger/ src/ extensions/chat/index.ts test/ docs/{CALLING.md,INBOX.md} logs/ledger.sqlite
~/.pi/agent-ollama/{.env,.gitignore}
~/.pi/agent-ollama/ollama/                    same shape, plus models.json
~/.local/bin/pi-cloud  ~/.local/bin/pi-ollama launchers, 0755
```

Launchers source only their own `.env`, export `PI_CODING_AGENT_DIR`, pin node to
`~/.nvm/versions/node/v24.22.2/bin`, read `default-model.json` and pass `--provider/--model/--thinking`.
`PI_NODE_BIN` overrides the node pin.

## How they were built (and why the scaffold was staged)

`skills/agent-creator/scripts/scaffold.ts` regenerates a sibling from the CoS home, so it cannot run
on the server as-is (no `~/.pi/agent/cos-orchestrator-agent` there). It was run **locally** against a
staged `HOME` holding only the template files it reads (`ledger/*.ts`, `src/{args,ask,default-model,
effective,prompt,session-command,usage,report}.ts`, `extensions/chat/index.ts`, `test/{args,effective}.test.ts`,
`tsconfig.json`, and a symlink to the real `.env` so `--copy-keys` could read it):

```bash
STAGE=~/tmp/server-agents-stage
node --experimental-strip-types ~/.pi/agent/cos-orchestrator-agent/skills/agent-creator/scripts/scaffold.ts \
  --name cloud --purpose "..." --tools "read,bash,edit,write,grep,find" \
  --provider deepseek --model deepseek-flash --thinking low --copy-keys --skip-smoke-test   # HOME=$STAGE
node --experimental-strip-types .../scaffold.ts \
  --name ollama --purpose "..." --tools "read,bash" \
  --provider ollama --model gemma4:12b --thinking low --skip-smoke-test                    # HOME=$STAGE
```

Because the staged template has no `package.json`, the script's `fetch:publications` step fails
harmlessly — **the laptop roster was deliberately not updated**: these agents are remote, so the
laptop's launchers cannot call them. A shim is still open work (see INBOX).

Then, before transfer: launcher node pin `v24.21.0` → `v24.22.2`; devDeps `1.4.0` → `^1.5.0`
(+ `typebox`); `pi` upgraded globally on the server `1.4.0` → `1.5.0` (same as the laptop);
`rsync -a` of both containers and both launchers; `npm install`, `npm run typecheck`, `npm test`
in each home.

## Local-model wiring (`~/.pi/agent-ollama/ollama/models.json`)

```json
{"providers":{"ollama":{"name":"Ollama (LAN server, RTX 3060)",
 "baseUrl":"http://127.0.0.1:11434/v1","api":"openai-completions","apiKey":"ollama",
 "models":[{"id":"gemma4:12b","contextWindow":16384,"maxTokens":4096,
            "cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}},
           {"id":"qwen3.5:9b", "...": "same"},
           {"id":"qwen2.5vl:7b","input":["text","image"],"...":"same"}]}}}
```

`enabledModels` in `settings.json` lists only those three; `default-model.json` is
`{"provider":"ollama","model":"gemma4:12b","thinking":"low"}`. The dummy key makes the model
selectable; Ollama ignores it. Ollama stays bound to `127.0.0.1:11434` — pi runs on the same box,
so no tunnel and no exposure. See `rtx3060-ollama-server-install.md` for the server side.

## Verification (2026-11-08)

| Check | Result |
| --- | --- |
| `pi-cloud -p "Reply with exactly: OK"` | `OK` |
| `pi-cloud --provider openai --model gpt-6.1-sol` | `OAI` |
| `pi-cloud -p '/ask ...'` | `ASK-OK`, footer `[cloud] deepseek/deepseek-flash · in 62 · out 4 · 5.88s` |
| `pi-ollama -p "Reply with exactly: OK"` | `OK` |
| `pi-ollama -p '/ask ...'` | `ASK-OK`, footer `[ollama] ollama/gemma4:12b · in 45 · out 52 · est unrated · 0.99s` |
| `pi-ollama --model qwen3.5:9b` | `SWITCH-OK` (model hot-swap from `default-model.json` works) |
| `pi-ollama` tool call: "run `date +%Y`, reply the year" | `2026` — bash tool call executed and answered |
| `pi-cloud -p '/ask ...'` after copying the provider catalog | footer `est $0.000034 · pi $0.000034` (was `est unrated`) |
| `ollama ps` during a request | `gemma4:12b · 100% GPU · CONTEXT 16384` |
| `npm run typecheck` / `npm test` (both homes) | clean / 18 tests, 0 fail |
| ledgers | `~/.pi/agent-cloud/cloud/logs/ledger.sqlite`, `~/.pi/agent-ollama/ollama/logs/ledger.sqlite` |

## Known gaps

- **Gemini is dead on arrival.** `GEMINI_API_KEY` in the laptop's `~/.pi/agent/.env` returns
  `400 API_KEY_INVALID` — from the laptop too, with `curl`, so the key is stale, not mangled in
  transit. `gemini-3.8-flash` / `gemini-3.7-flash` stay listed in `enabledModels` but fail until a
  new key is put in both `.env` files.
- **No OAuth credential was transferred.** Every `auth.json` in this tree is `{"type":"api_key"}`;
  there is no OAuth token to copy. `pi`'s OAuth lives in `/login` (browser or device flow, with a
  pasted redirect code) and is a human step on the server, done once per provider. Both agents
  currently authenticate through environment variables only; `/login` writes `auth.json` beside the
  agent's `settings.json` when used.
- **No laptop shim.** CoS cannot delegate to these agents; it would need a local launcher that
  `ssh lan-pmpmt ...` (roster unchanged) or a publication contract. Tracked in `docs/INBOX.md`.
- **`gemma4:12b` reports ~1.16 GB resident** for an 8.0 GB Q4_K_M model while at 100% GPU and
  answering fast. Ollama's own numbers, not touched; worth a look if a model ever spills to CPU.
- Node modules were installed per home (`npm install`), not symlinked to a template home — the
  scaffold's symlink would point at a laptop path that does not exist on the server.
- **Rate card.** Neither home had one, and pi creates an empty `models-store.json` (`{}`) on the
  server, so `/usage` said `est unrated`. The laptop's 47 KB provider catalog
  (`~/.pi/agent/cos-orchestrator-agent/models-store.json` — model metadata and list prices, no keys)
  was copied to both homes as a read-only fallback. A real `model-rates.json` in a container dir
  still wins over it when present.
