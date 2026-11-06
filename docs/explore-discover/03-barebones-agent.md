# 03 — Creating a new barebones agent

- **Date:** 2026-11-03
- **Host:** dev laptop `pmpmt`, Node `v24.21.0`, pi `1.4.0`
- **Sources (local, version 1.4.0):**
  - `.../@earendil-works/pi-coding-agent/docs/quickstart.md`, `cli.md` (§Models, §Tools, §Resources, §Prompts), `sdk.md`, `packages.md`, `configuration.md`, `environment-variables.md:81`
  - `.../dist/core/sdk.d.ts:10-65` — `CreateAgentSessionOptions` (the authoritative option list)
  - `.../dist/core/model-runtime.d.ts:70-73` — `ModelRuntime.getModel(provider, id)`
  - `.../dist/core/agent-session.d.ts:663` — `setModel()`
  - `.../examples/sdk/{01-minimal,03-custom-prompt,12-full-control}.ts`
  - Live reference agents on this machine: `~/.local/bin/pi-image-describer` (smallest launcher), `pi` (fullest)
- **Everything below was executed.** Transcripts are real, not illustrative.

---

## 0. "Agent" means two different things

| Kind | What it is | When to pick it |
|---|---|---|
| **Home + launcher agent** | A directory of config (`AGENTS.md`, `settings.json`, `.env`) plus a 10-line bash launcher that sets `PI_CODING_AGENT_DIR` | You want a *persona/toolset* with the normal pi TUI, CLI, sessions, cron, Telegram — i.e. a sibling agent like `image-describer` |
| **Embedded (SDK) agent** | TypeScript that calls `createAgentSession()` inside your own process | You are building a *program* that happens to think — a script, a service, a CI step |

Recipe A is the one this workspace uses for every sibling. Recipe B is the one to use inside a Node program.

---

## 1. Recipe A — a barebones CLI agent (verified)

### Files

```text
~/.pi/agent-hello/
├── .env                      # only this agent's keys (DEEPSEEK_API_KEY=…)
└── hello/
    ├── settings.json         # model + tool subset
    └── AGENTS.md             # the persona; loaded as the global context file
~/.local/bin/pi-hello         # the launcher
```

That's five files, one of which is a symlink-free bash script. pi creates `auth.json` and `models-store.json` in the home on first run — you do not write them.

### The launcher (the whole mechanism)

```bash
#!/bin/bash
# pi-hello — isolated launcher. Sources ONLY this agent's .env.
set -a
ENV_FILE="$HOME/.pi/agent-hello/.env"
[ -f "$ENV_FILE" ] && source "$ENV_FILE"
set +a

export PI_CODING_AGENT_DIR="$HOME/.pi/agent-hello/hello"

NODE_BIN="${PI_NODE_BIN:-$HOME/.nvm/versions/node/v24.21.0/bin}"
export PATH="$NODE_BIN:$PATH"
exec "$NODE_BIN/pi" "$@"
```

Three lines do all the work:

1. `set -a` + `source .env` — provider credentials reach the process as environment variables (`providers.md`: `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`). This is why a launcher exists at all: `~/.local/bin/pi` sources the *main* agent's `.env`, so a bare `pi` would give the new agent somebody else's identity and keys.
2. `PI_CODING_AGENT_DIR` — the single switch that moves the config home away from `~/.pi/agent` (`environment-variables.md:81`). Everything below it (settings, `AGENTS.md`, sessions, skills, extensions, prompts) is rediscovered relative to the new home.
3. `exec "$NODE_BIN/pi"` — `exec`, so no extra shell sits in the process tree and signals/exit codes pass through. Pinning `NODE_BIN` avoids nvm's shell-type-dependent PATH.

Note what the launcher does **not** do: no model flags, no `--no-extensions`. Model choice belongs in `settings.json`; suppression flags belong in explicit calls. `pi` adds one optional block on top — a debounced `git pull --ff-only` guarded by `PI_SUBAGENT_*` — which a new agent does not need.

### `settings.json`

```json
{
  "defaultProvider": "deepseek",
  "defaultModel": "deepseek-flash",
  "defaultThinkingLevel": "low",
  "defaultTools": ["read", "bash"]
}
```

`defaultTools` is what makes it "barebones with two tools": the default is `read, bash, edit, write` (`cli.md` §Tools). Naming a list replaces that selection.

### `AGENTS.md`

```markdown
# hello

You are hello, a two-tool research assistant. Answer in one paragraph.
```

A file named `AGENTS.md` at the **agent home root** is the *global* context file (the same role `~/.pi/agent/AGENTS.md` plays for the stock agent). Project files, `<cwd>/AGENTS.md` and up the tree, are added on top when present. This is the only place persona text is needed — no custom system prompt required.

### Verified transcripts

```console
$ cd /tmp && pi-hello -ns -ne --no-session -p "Who are you and which tools do you have? One sentence."
I'm hello, a two-tool research assistant, and I have exactly two tools available:
`read` (to view file contents) and `bash` (to run shell commands).
```

```console
$ cd /tmp && pi-hello -ns -ne -nc --no-session -p "Who are you and which tools do you have?"
I'm pi, a coding assistant with read and bash tools for inspecting files and running commands.
```

The second run proves a trap: **`-nc` (`--no-context-files`) silently disables `AGENTS.md`.** The agent falls back to the built-in identity and the persona vanishes with exit code 0. If a new agent "ignores its instructions", check `-nc` / `--no-context-files` first.

### What each flag actually removes

| Flag | Removes | Leaves |
|---|---|---|
| `-nbt` / `--no-builtin-tools` | `read, bash, edit, write` | extension + custom tools |
| `-nt` / `--no-tools` | built-in, extension, custom, MCP | nothing callable |
| `-t read,grep` | replaces the selection entirely with that allowlist | — |
| `-ns --no-skills` | discovered + configured skills | `--skill` paths |
| `-ne --no-extensions` | discovered, configured, **and built-in** extensions | `-e` paths (`pi -ne -e builtin:mcp` keeps only MCP) |
| `-nc --no-context-files` | `AGENTS.md` / `CLAUDE.md` — **including the home one** | system prompt, tools |
| `--no-session` | session file on disk | the in-memory conversation |
| `--system-prompt <text\|path>` | the entire composed system prompt | — |

Most-bare invocation that still talks (verified, exit 0):

```console
$ PI_CODING_AGENT_DIR=/tmp/pi-bare/home pi -nbt -ns -ne -nc --no-session \
    --provider deepseek --model deepseek-flash -p "Reply with exactly: BAREBONES OK"
BAREBONES OK
```

The `/tmp/pi-bare/home` directory did not exist beforehand. pi created it with just:

```text
auth.json          (2 bytes: "{}")
models-store.json  (2 bytes: "{}")
```

So an empty `PI_CODING_AGENT_DIR` is a valid, fully functional agent home — no scaffolding required. Everything else is opt-in.

### The five-minute checklist

1. `mkdir -p ~/.pi/agent-hello/hello`
2. Write `settings.json` (provider/model/tools) and `AGENTS.md` (persona).
3. Put this agent's own keys in `~/.pi/agent-hello/.env`.
4. Copy the launcher above to `~/.local/bin/pi-hello`, `chmod +x`.
5. `cd /tmp && pi-hello -p "Who are you?"` — then add `--no-session` while iterating so the test does not litter `sessions/`.
6. Optional, and specific to this workspace's convention: add `agent.json` (name, launcher, defaultPrompt, purpose, contract) so the roster generator can discover it. pi itself never reads that file.

Do **not** reuse `~/.pi/agent` as the new home. It is the harness-state directory for the main agent (`auth.json`, `settings.json`, `sessions/`, `trust.json`); pointing a new persona at it silently inherits the main agent's credentials and settings.

---

## 2. Recipe B — a barebones embedded agent (verified)

### The true minimum

```typescript
// sdk-minimal.ts   — run: node sdk-minimal.ts
import { createAgentSession } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession();
try {
  session.subscribe((e) => {
    if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta")
      process.stdout.write(e.assistantMessageEvent.delta);
  });
  await session.prompt("What files are in the current directory?");
} finally {
  session.dispose();
}
```

That is `examples/sdk/01-minimal.ts` minus bookkeeping. It uses `process.cwd()`, discovers extensions/skills/prompts/context from cwd and the agent home, takes the model from settings or the first credentialed one, and persists a session file. In other words: minimal *code*, not minimal *agent*.

### Barebones the other way — no discovery, no tools, custom prompt (verified)

```typescript
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";

const agentDir = "/tmp/pi-bare/home";

const loader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir,
  systemPromptOverride: () => "You are a two-line assistant. No tools. Be terse.",
  appendSystemPromptOverride: () => [],   // stop APPEND_SYSTEM.md leaking in
});
await loader.reload();

const { session } = await createAgentSession({
  cwd: process.cwd(),
  agentDir,
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(),  // no session file
  noTools: "all",                             // nothing callable
});

session.subscribe((e) => {
  if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta")
    process.stdout.write(e.assistantMessageEvent.delta);
});

try {
  await session.prompt("Say SDK BAREBONES OK in one line.");
  console.log("\n[tools]", session.getActiveToolNames());
  console.log("[prompt]", session.systemPrompt.replace(/\n/g, " | "));
} finally { session.dispose(); }
```

Observed:

```text
[tools] []
[prompt] You are a two-line assistant. No tools. Be terse. |  | <cwd> | /tmp/pi-bare | </cwd>
[next run] TEXT: "SDK BAREBONES OK"
EVENTS: agent_start, turn_start, message_start, message_end,
        message_update:text_start, message_update:text_delta, message_update:text_end,
        turn_end, agent_end, agent_settled
```

Four things this proves:

1. `systemPromptOverride` replaces the composed prompt, **but pi still appends the `<cwd>` block**. That trailing block is not part of the override — it is added by the session, so "replace the prompt entirely" means "replace everything except the cwd line".
2. `appendSystemPromptOverride: () => []` is mandatory if you want a clean prompt; otherwise `DefaultResourceLoader` appends `APPEND_SYSTEM.md` from the agent home and the cwd. `examples/sdk/03-custom-prompt.ts` calls this out.
3. `SessionManager.inMemory()` is what makes it an ephemeral agent — no JSONL, and `session.prompt()` is the only history.
4. Streaming does not require tools; `message_update`/`text_delta` arrives regardless.

### Pinning a model in code (verified)

```typescript
import { createAgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create({
  authPath: "/tmp/pi-bare/home/auth.json",
  modelsPath: "/tmp/pi-bare/home/models.json",
});
const model = modelRuntime.getModel("deepseek", "deepseek-flash");
if (!model) throw new Error("model not found");
// ...then pass { modelRuntime, model } to createAgentSession
```

Observed: `TOOLS: [] MODEL: deepseek/deepseek-flash` → `TEXT: "PINNED OK"`.

Two failed attempts worth knowing about, both silent:

- `model: { provider: "deepseek", id: "deepseek-flash" } as any` — the run **exited 0 with no assistant text at all**. `model` must be a real `Model` object; get it from `ModelRuntime`, not from a literal.
- `import { getModel } from "@earendil-works/pi-ai/compat"` (as `examples/sdk/12-full-control.ts` does) fails with `ERR_MODULE_NOT_FOUND` from outside the pi repo: `pi-ai` lives at `.../pi-coding-agent/node_modules/@earendil-works/pi-ai`, which is not on an external project's resolution path. When embedding, either rely on the agent-home `settings.json`, use `ModelRuntime`, or install `@earendil-works/pi-ai` yourself.

`noTools` is `"all" | "builtin"` (`dist/core/sdk.d.ts:33`) — `noTools: true` is off-type. `"builtin"` removes `read/bash/edit/write` but keeps extension and custom tools; `"all"` removes everything.

### When to keep going to full control

`examples/sdk/12-full-control.ts` replaces the `ResourceLoader` with a hand-written object (`getExtensions`, `getSkills`, `getPrompts`, `getThemes`, `getAgentsFiles`, `getSystemPrompt`, …) plus `SettingsManager.inMemory()` and a private `ModelRuntime`. That is the ceiling: no filesystem discovery at all. Use it when the host owns storage — a database-backed service, an embedded app — not for a first agent, because you then own every resource list forever.

---

## 3. Which knobs exist

`CreateAgentSessionOptions` (`dist/core/sdk.d.ts:10-65`), grouped:

| Boundary | Options | Leave out and you get |
|---|---|---|
| Workspace | `cwd` | `process.cwd()` |
| Config home | `agentDir` | `~/.pi/agent` (or `PI_CODING_AGENT_DIR`) |
| Model | `modelRuntime`, `model`, `thinkingLevel`, `scopedModels` | settings, else first credentialed model |
| Persistence | `sessionManager` | `SessionManager.create(cwd)` — files on disk |
| Settings | `settingsManager` | `SettingsManager.create(cwd, agentDir)` |
| Resources | `resourceLoader` | `DefaultResourceLoader` (full discovery) |
| Tools | `tools`, `excludeTools`, `noTools`, `customTools` | `defaultTools` setting, else `read/bash/edit/write` |

The CLI's own built-in extensions (`codemode`, `tool_search`, MCP) are **not** loaded by the SDK (`docs/sdk.md`); the CLI layer adds them. A barebones SDK agent therefore has fewer moving parts than a barebones CLI agent with the same flags.

---

## 4. Startup order, minimally

```text
launcher sets PATH + .env + PI_CODING_AGENT_DIR
  → pi resolves agentDir, reads auth.json / models-store.json / settings.json
  → credentials: .env API key beats stored auth
  → resource discovery from agentDir and cwd (extensions, skills, prompts, themes,
    AGENTS.md, project trust gate)
  → system prompt composed (identity, tools, guidelines, docs paths, APPEND_SYSTEM,
    AGENTS.md, skills, cwd) — or replaced by --system-prompt / systemPromptOverride
  → tool selection resolved (defaultTools / --tools / noTools)
  → session (file or memory) → agent loop
```

Every "why does my new agent behave like the old one?" bug is one of those arrows leaking: wrong `PI_CODING_AGENT_DIR`, an inherited `.env`, `DefaultResourceLoader` picking up the host's `AGENTS.md`/`APPEND_SYSTEM.md`, or `-nc`/`-nt` quietly erasing the persona.

---

## 5. Not verified here

- `pi install` / publishing a *package* agent (`docs/packages.md`) — the distribute-ready form of Recipe A, with `extensions/`, `skills/`, `prompts/`, `themes/` and a `pi` manifest in `package.json`.
- SDK agents **with** tools (`examples/sdk/05-tools.ts`) or with extensions loaded (`06-extensions.ts`).
- `AgentSessionRuntime` (`newSession`/`fork`/`switchSession`) on a barebones session.

---

## Next

1. **04-provider-architecture** — how `ModelRuntime` resolves credentials, why `.env` beats `auth.json`, model capability clamping, and streamed events (`pi-ai`).
2. **05-system-prompt-composition** — the 8 sections, plus proof of the `<cwd>` block that survives `systemPromptOverride`.
3. **06-session-management** — `SessionManager` JSONL trees, since Recipe B deliberately bypassed it with `inMemory()`.
4. **Packaging a barebones agent** — turn Recipe A into an installable pi package.
