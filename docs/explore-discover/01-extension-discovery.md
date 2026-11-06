# 01 — Extension discovery and load order

- **Date:** 2026-11-03
- **Host:** dev laptop `pmpmt`, Ubuntu, Node `v24.21.0` (nvm), pi `1.4.0`
- **Agent home (this session):** `~/.pi/agent/cos-orchestrator-agent` (`PI_CODING_AGENT_DIR`)
- **cwd:** `/home/pmpmt/.pi`
- **Sources read (all local, no network):**
  - `~/.nvm/versions/node/v24.21.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
  - `.../docs/configuration.md`, `.../docs/settings.md`, `.../docs/security.md`
  - `.../dist/core/package-manager.js`, `.../dist/core/resource-loader.js`,
    `.../dist/core/extensions/loader.js`, `.../dist/core/extensions/index.js`,
    `.../dist/cli/args.js`, `.../dist/config.js`

> **Path warning.** Older notes point at `.../node_modules/.../v24.18.0/`. That tree holds
> pi **0.99.1** and is not what runs. The live tree is `v24.21.0`, pi **1.4.0**. Every line
> reference below is from `v24.21.0`.

---

## 1. What an extension is

A TypeScript (or JavaScript) module whose default export is a factory that receives
`ExtensionAPI`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("commit", { /* ... */ });
}
```

- Loading uses **jiti**, so `.ts` runs with no build step (`extensions.md`, "Create and load").
- The factory may be `async`; Pi waits for it before continuing startup.
- It runs **in the Pi process with the same OS permissions** — it can read prompts, files,
  credentials, session history. Trust matters (see §7).
- Do not start process/socket/timer work in the factory: some invocations load extensions
  without starting a session. Use `session_start` / `session_shutdown` for that.

Live example on this machine, `~/.pi/agent-.../extensions/git-commit.ts`: a factory that
calls `pi.registerCommand("commit", …)` and shells out via `pi.exec("git", …)`.

---

## 2. Where Pi looks, and in what order

Two layers cooperate:

1. **`dist/core/package-manager.js` → `resolve()` (line 704)** produces the ordered list of
   enabled resource paths (extensions, skills, prompts, themes) with metadata
   (`{source, scope, origin, baseDir}`).
2. **`dist/core/resource-loader.js` → `reload()` (line ~300s)** merges in CLI `-e` paths and
   calls the loader. **`dist/core/extensions/loader.js` → `loadExtensionsInternal()` (line 553)**
   imports each file in array order and calls its factory.

Effective order of the extension path list (first writer wins per path —
`addResource()` at `package-manager.js:2096` uses `if (!map.has(path))`, and `Map`
insertion order is the load order):

| # | Source | Code |
|---|---|---|
| 1 | **CLI** `-e/--extension` paths (`temporary` scope) | `resource-loader.js:409` merges CLI paths **first** via `mergePaths(cliEnabledExtensions, enabledExtensions)` (line 786) |
| 2 | **Project packages** `packages` in `<cwd>/.pi/settings.json` | `package-manager.js:710-721` |
| 3 | **User packages** `packages` in `<agent-dir>/settings.json` (project wins on same identity) | same block, `dedupePackages` |
| 4 | **Project settings `extensions[]`** entries, resolved from `<cwd>/.pi` | `package-manager.js:725` |
| 5 | **User settings `extensions[]`** entries, resolved from `<agent-dir>` | `package-manager.js:730` |
| 6 | **Auto-discovered project extensions** `<cwd>/.pi/extensions/` — **only if the project is trusted** | `addAutoDiscoveredResources` (line 1987), project block before the user block |
| 7 | **Auto-discovered user extensions** `<agent-dir>/extensions/` | same function, "User extensions from ~/.pi/agent/" |
| 8 | **Built-in extensions** `builtin:llama.cpp`, `builtin:codemode`, `builtin:tool-search`, `builtin:mcp` | `package-manager.js:737-745`, `dist/extensions/index.js:5-12` |

On this host that means: `~/.pi/.pi/extensions/{pi-event-tracer,session-memory}` (project,
cwd is `/home/pmpmt/.pi`) load **before** `~/.pi/agent/cos-orchestrator-agent/extensions/*`
(user), despite the project being "lower priority" in everyday language. Order is not
priority here — nothing overrides by being later except duplicate-path dedupe, which drops
the later copy.

### Fallback: `discoverAndLoadExtensions()` (SDK path, not the CLI path)

`loader.js:673` has a simpler, self-contained discovery used by the SDK/`--print` style
callers:

```js
// 1. project-local:  <cwd>/.pi/extensions/
// 2. global:         <agentDir>/extensions/
// 3. configuredPaths (explicit, `-e` style)
```

It uses `discoverExtensionsInDir()` (line 635) instead of the package-manager collector.
Same entry rules, slightly different ignore behavior (see §3).

---

## 3. Discovery rules **inside** an extensions directory

Two nearly identical implementations — `package-manager.js:381 collectAutoExtensionEntries`
(what the CLI actually uses) and `loader.js:635 discoverExtensionsInDir` (SDK path).
Both follow:

1. If the directory **itself** has a `package.json` with `pi.extensions` → use exactly those
   declared paths. Else if it has `index.ts`, use it. Else `index.js`.
2. Otherwise scan **one level only**:
   - any `.ts` / `.js` **file** at the root → load it
   - any **subdirectory** → resolve its entry via (1): `package.json` `pi.extensions` >
     `index.ts` > `index.js`. A subdirectory without one of those contributes nothing.
3. **No recursion beyond one level.** `extensions/foo/bar/index.ts` is never found; foo must
   have a `package.json` naming `bar/index.ts` or be flattened.

Collector-specific behavior (`collectAutoExtensionEntries`):

- skips dotfiles and `node_modules`
- honors a `.gitignore` in that directory (`addIgnoreRules`, `package-manager.js:418-419`)
- follows symlinks, using `statSync` (a broken link is skipped)

Consequences worth internalizing:

- `extensions/git-commit.ts` ✔ loads
- `extensions/chat/index.ts` ✔ loads
- `extensions/chat/helper.ts` ✘ ignored (only the entry file is loaded; import it from
  `index.ts` instead)
- `extensions/chat/README.md` ✘ ignored
- `extensions/x/y/index.ts` ✘ ignored (two levels deep)

---

## 4. Enable / disable from settings

`settings.json` `extensions` is a `string[]`; relative paths resolve from the agent dir
(user settings) or `<cwd>/.pi` (project settings). Prefix semantics come from
`isEnabledByOverrides` (`package-manager.js:523`) and `applyPatterns` (line 548):

| Prefix | Meaning |
|---|---|
| *(none)* | plain include: only matters when a plain include list exists elsewhere; also matched as a glob |
| `!pattern` | exclude (glob) |
| `+path` | force-include, **exact** path only |
| `-path` | force-exclude, **exact** path, wins over `+` |

**Default is enabled.** A file discovered on disk loads unless something excludes it. So the
`+extensions/…` entries in this agent's `settings.json` are redundant *for enabling* — they
add the path explicitly, and auto-discovery would have added the same path anyway (deduped by
`addResource`). The one file in that directory **not** listed, `extensions/git-commit.ts`,
still loads by auto-discovery. To actually stop it you need `-extensions/git-commit.ts`.

Built-ins: `-builtin:mcp` etc. disables one; `+builtin:<name>`/`-builtin:<name>` in project
settings overrides the user setting. Replaceable built-ins (`codemode`, `tool-search`, `mcp`)
are dropped when another extension registers a colliding tool/command name —
`omitReplacedExtensions` in `resource-loader.js:71-100` emits a warning explaining which
extension won.

---

## 5. CLI flags

`dist/cli/args.js`:

```
-e, --extension <path>   load an extension file, directory, or builtin:<name>; repeatable (line 156)
-ne, --no-extensions     skip discovery AND built-ins; explicit -e paths still load (line 160)
```

- `-e` paths are `scope: "temporary"` and are merged **in front of** discovered paths.
- `-e builtin:mcp` re-enables a built-in you disabled in settings.
- `pi --help` also prints an "Extension CLI Flags" section listing flags registered by
  loaded extensions (`printHelp(extensionFlags)`, line 267) — proof that extensions can add
  their own CLI flags.

---

## 6. Load mechanics and failure behavior

```
loadExtension (loader.js:527)
  ├─ loadExtensionModule (line 465) → jiti import with `moduleCache: false`,
  │  result cached per (extensionPath, cwd, generation); alias table maps
  │  @earendil-works/pi-{coding-agent,agent-core,tui,ai*} and typebox to the
  │  installed copies (getAliases, line 39) so extensions never double-load a second pi
  ├─ no factory?          → error "does not export a valid factory function"
  └─ initializeExtension (line 513)
        createExtension → createExtensionAPI → await factory(api)
        success → load.commit()   |   throw → load.discard(), rethrow
```

- A throwing factory does **not** abort startup. It becomes
  `errors: [{path, error: "Failed to load extension: …"}]` on the result, and the next
  extension loads (line 561-570).
- `loadExtensionsCached` (no-cache variant `loadExtensions`) is keyed on cwd +
  `extensionCacheGeneration`; `clearExtensionCache()` runs at the start of every
  `resource-loader.reload()`, i.e. `/reload` re-imports fresh code.
- `initializeExtension` uses a staging API (`commit`/`discard`), so a factory that throws
  halfway leaves no half-registered tools or commands.
- Timings land under the `"extensions"` bucket (`time(...)`, `timings.js`) — visible with the
  startup timing output.

---

## 7. Project trust gate

`resource-loader.js:349-372`:

1. A **pre-trust pass** (`loadProjectTrustExtensions`) forces `projectTrusted = false`, then
   loads only user/global + CLI extensions.
2. `resolveProjectTrust({extensionsResult})` decides trust (interactive prompt, remembered in
   `trust.json` — present in this agent home). Only **personal** and **CLI** extensions can
   participate in the `project_trust` event, because project extensions are not loaded yet.
3. Trust granted → settings and project resources reload with `projectTrusted = true`, and
   the final extension set is loaded (`loadFinalExtensionSet`, line 512).

So a project `.pi/extensions/*.ts` is inert until you trust the directory. Docs:
`security.md#understand-project-trust`.

---

## 8. What this machine actually loads

```
# user (~/.pi/agent/cos-orchestrator-agent/extensions/)
auto-sync.ts            cron.ts              git-commit.ts
pi-prompt-capture.ts    secret-scrubber.ts
chat/index.ts           input-contains-email/index.ts   input-contains-path/index.ts
input-contains-url/index.ts                             less-than-input-words/index.ts
packages: npm:@llblab/pi-telegram   (→ npm/node_modules/@llblab/pi-telegram)

# project (/home/pmpmt/.pi/.pi/extensions/, cwd = /home/pmpmt/.pi)
pi-event-tracer/index.ts        session-memory/index.ts
```

The `inputContainsEmail / found: false …` block appended to this session's prompt is exactly
what `input-contains-url/index.ts` and its siblings do: an `input` handler (per-turn display)
plus a `before_agent_start` handler returning
`{ message: { customType, content, display: false } }` — a hidden labeled message injected
for the model on every user turn. That is the next topic's subject.

Verify what is installed at the package level with:

```bash
pi list          # user packages + resolved package roots
pi config        # interactive: extensions/skills/prompts toggles, built-ins section
```

---

## 9. Try it

```bash
# 1. Minimal extension, no settings edit needed (auto-discovered):
mkdir -p ~/.pi/agent/cos-orchestrator-agent/extensions
cat > ~/.pi/agent/cos-orchestrator-agent/extensions/hello.ts <<'EOF'
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  pi.registerCommand("hello", {
    description: "Show a greeting",
    handler: async (name, ctx) => ctx.ui.notify(`Hello, ${name || "world"}!`, "info"),
  });
}
EOF
# then, inside pi: /reload  →  /hello

# 2. Load without touching disk config:
pi -e ./hello.ts

# 3. Prove the "one level only" rule:
T=$(mktemp -d) && mkdir -p $T/demo/inner
cp ~/.pi/agent/cos-orchestrator-agent/extensions/git-commit.ts $T/demo/inner/
cp ~/.pi/agent/cos-orchestrator-agent/extensions/git-commit.ts $T/demo/ok.ts
pi -e $T/demo            # ok.ts loads (adds /commit); demo/inner/* is never seen

# 4. Disable one extension without deleting it:
#    add "-extensions/git-commit.ts" to extensions[] in settings.json, then /reload
```

---

## Next

**02 — Event lifecycle.** 32 events total (12 hooks that return control values, 20
notification-only events), the startup → `input` → `before_agent_start` → `agent_start` →
turns → `agent_end` → `agent_before_settle` → `agent_settled` flow from
`docs/extensions.md`, and which handlers in this home's `input-contains-*` and
`pi-prompt-capture.ts` extensions fire at each step.
