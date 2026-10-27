# chat-meter-web Settings UI — Setup & Implementation Report

**Date:** 2026-10-27
**System:** Ubuntu 24.04.5 LTS (Pi v1.4.0, Node v24.21.0)
**Location:** `~/chat_meter_web/chat-meter-web/dashboard/` (server + UI), `~/chat_meter_web/chat-meter-web/{web-search.json,default-model.json}`, `~/chat_meter_web/{model-rates.json,tool-rates.json}`

---

## Problem

`chat-meter-web` is a replica of `~/chat_meter` — a chat agent whose whole purpose is showing
where money went. By the start of this work it could answer, search the web, and meter both,
but its dashboard had exactly one editable control: provider / model / effort, writing
`default-model.json`. Everything else that shapes a run — the search route, the workflow, the
price cards, the `/ask` prompt — existed only as JSON that had to be hand-edited, and the
previous hour had been spent writing prose instructions explaining how to hand-edit the route.

The sibling agent `~/web_searcher/web-searcher` already had the target shape: hash-routed
tabs (`#metrics` / `#settings`), one settings section per config file, a status line per
section, and small `group()` / `block()` / `label()` helpers instead of a framework.

Goals:

1. Bring that shell to `chat-meter-web` without a build step (this dashboard is one process, not Vite).
2. Give each settings file its own section, saving independently.
3. Keep the "an unknown price is never $0" rule visible in the UI.

---

## Investigation

### Sources read

| Source | What it established |
| --- | --- |
| `~/web_searcher/web-searcher/web-searcher/dashboard/src/main.ts` | `hashchange` listener, `show()` toggling panels, `aria-current` on the active tab |
| `…/dashboard/src/settings/model.ts` | Section pattern: load → `group()` → `block()` → `fields` → `status`; save per section |
| `…/dashboard/src/registry.ts` | Visualisations are a list; the shell knows nothing about them |
| Pi `docs/settings.md:42` | `defaultTools: []` disables built-in tools but **not** extension tools — so enabling a package needs no tool-config change |
| `pi-web-access/utils.ts` (installed 0.44.0) | `PI_CODING_AGENT_DIR` wins unconditionally for `web-search.json`, which is what keeps the replica's config isolated |
| Screenshot `Screenshot from 2026-10-27 11-50-05.png` | The visual target: tabs, per-file sections, key hints beside controls, `Rates: built-in` + `live` indicators |

No web research was needed: every question was answered by sibling source, Pi docs, or the
installed package.

### Defects found while building

| # | Defect | Evidence |
| --- | --- | --- |
| 1 | **`unrated` rendered as `$0.000000`** in the per-model totals table, so an unknown price read as free | First screenshot: `openai/gpt-4.1-mini … est $0.000000` while its 3 calls were unrated |
| 2 | Summary card did not mention that 4 of 7 calls had no price | Same screenshot: `chat $0.002055 · tools $0.000000` |
| 3 | **A second dashboard on 8787 died with a raw `EADDRINUSE` stack trace**, and the *stale* process answered the API — which made a correct wiring look broken | `dash3.log`; API returned an old payload |
| 4 | Verification screenshots showed stale JS: the browser kept `app.js` while SSE updated the data, so the page re-rendered old code | Second screenshot identical to the first after patches |

---

## Architecture / Design Decisions

### What was borrowed from the sibling

- Hash routing with `aria-current`, panels hidden rather than re-rendered.
- One section per file, each with its own **status line** and its own **save**.
- Section helpers: group → block → labelled field.
- Header indicators showing state without opening anything (`rates:`, `tools:`, `live`).

### What was deliberately different

| Sibling | chat-meter-web | Why |
| --- | --- | --- |
| Vite dev server on 5173 + API on 8787 | One `node:http` process on 8787 | No build step to forget, no CORS origin list, no second install |
| echarts | Inline SVG charts | Zero dependencies in the dashboard |
| Sections edit mode files, site lists, provider, prompt | Model, Web search, Prices, Prompts | Matches this agent's four config files |
| `Rates: built-in` | `rates: file · <hash>` and `tools: file · <hash>` | Both price cards exist here, and each is content-hashed so a row can be traced to a card |
| — | **Prices and Prompts are read-only** | Editing a card silently re-prices all history; that deserves a file plus git, not a text field |

### Key detection without holding secrets

The route editor needs to say `brave — no key` without the dashboard reading a key. The server
parses `~/chat_meter_web/.env` for **variable names only** (`/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/`,
keeping just the name when the value is non-empty) and merges the process environment. No value
ever enters the process or the response.

### Effective-time semantics, made explicit in the UI

| Section | File | Takes effect |
| --- | --- | --- |
| Model | `default-model.json` | next **launch** |
| Web search | `web-search.json` | next **search** (config is re-read per call) |
| Prices | `model-rates.json`, `tool-rates.json` | immediately — re-prices history |
| Prompts | `prompts.json` | next `/ask` |

---

## Implementation

### Phase 1 — shell

`index.html` rebuilt as header + two `<main>` panels: `#view-metrics` (existing sections moved
verbatim) and `#view-settings`. `app.js` gained a 10-line router:

```js
const VIEWS = ["metrics", "settings"];
function show() {
  const requested = location.hash.slice(1);
  const active = VIEWS.includes(requested) ? requested : "metrics";
  for (const view of VIEWS) el(`view-${view}`).hidden = view !== active;
  for (const link of document.querySelectorAll("#tabs a")) {
    if (link.dataset.view === active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}
window.addEventListener("hashchange", show);
```

### Phase 2 — Model

Existing form kept, moved into the section pattern, status line added.

### Phase 3 — Web search (new route)

`GET /api/search-route` returns the route, the workflow, `fallbackOn`, and a `known[]` list:

```json
{ "name": "brave", "configured": false, "needs": "BRAVE_API_KEY", "note": "no key" }
{ "name": "exa",   "configured": true,  "needs": "EXA_API_KEY",  "note": "keyless MCP" }
```

`PUT /api/search-route` validates and writes **only** `searchRouting.providers` and `workflow`,
preserving every other key (notably `fallbackOn`):

- empty array → `400 The route needs at least one provider.`
- unknown name → `400 Unknown provider(s): kagi.`
- duplicate → `400 A provider appears twice in the route.`
- unknown workflow → `400 Unknown workflow "x".`

The editor is a numbered list with ↑ ↓ × per row, a picker for unlisted providers, a workflow
select, and one save.

### Phase 4 — Prices and Prompts

`GET /api/rates` returns both cards plus the **unrated** sets, computed by intersecting the card
with what the ledger actually contains:

```json
"models": { "source": "file", "version": "cc4440280944", "unrated": ["gemini-2.5-flash", "gpt-4.1-mini"] }
"tools":  { "source": "file", "version": "bfef47f4e776", "unrated": [] }
```

`GET /api/prompts` returns the effective `/ask` prompt, whether it came from `prompts.json` or
the built-in default, and the path it would read.

### Phase 5 — honesty and robustness fixes

1. **Unrated is not free.** The per-model row now renders an `unrated` chip (or `$x +N unrated`
   when partly rated), and the summary card appends `· N unrated`.
2. **`EADDRINUSE` explained.** The server handles the error instead of throwing:

```ts
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    process.stderr.write(`chat-meter dashboard: ${host}:${port} is already in use. Stop the other dashboard, or set DASHBOARD_PORT.\n`);
    process.exitCode = 1;
    return;
  }
  throw error;
});
```

3. **Verification discipline.** Screenshots are only trusted after `agent-browser reload` or a
   cache-busting query, because the page holds `app.js` while SSE refreshes only the data.

---

## Verification

| Check | Result |
| --- | --- |
| `npm test` | **82 pass** (4 new dashboard tests: route read/save with `.env` name detection, unknown + empty rejection, rate cards, prompt source) |
| `npm run typecheck` | clean |
| `adapt.py --check` | clean — no template strings reintroduced |
| `PUT /api/search-route` round trip | reordered route, file kept `fallbackOn`, original order restored |
| Screenshots | `#metrics` and `#settings` rendered from the live ledger; `unrated` chips confirmed after reload |

---

## Files Created / Modified

| File | Lines | Purpose |
| --- | --- | --- |
| `dashboard/server.ts` | 612 | +3 routes (`/api/search-route` GET/PUT, `/api/rates`, `/api/prompts`), `.env` name reader, search-config read/write, availability map, `EADDRINUSE` handling |
| `dashboard/public/index.html` | 124 | Header with tabs + indicators; `#view-metrics` and `#view-settings`; four settings sections |
| `dashboard/public/app.js` | 384 | Hash router, route editor (render/move/add/save), prices tables, prompt panel, `unrated` rendering |
| `dashboard/public/style.css` | 105 | Tabs, groups/blocks, route list, key markers, `.row` buttons, `<pre>` |
| `test/dashboard.test.ts` | 280 | +4 tests covering the new routes and validation |
| `~/chat_meter_web/README.md` | 220 | Settings-first instructions for changing the search order |
| `docs/CHEATSHEET.md` | 307 | Settings table (file → effect), UI-first route editing |
| `~/.pi/docs/pi-state-summary.md` | — | §13c dashboard entry: tabs, sections, new routes |

---

## Known gaps

- **Prices and Prompts are read-only.** Deliberate: a card edit re-prices all history, so it
  stays a file operation.
- **No rate-card editor means no validation surface.** A malformed `model-rates.json` falls back
  to the built-in table and reports the error in the indicator, but the UI cannot show *why*
  beyond the message.
- **The route editor cannot see per-provider quota or health.** It reports key presence only.
- **One dashboard at a time on 8787.** Two copies collide; the message now says so plainly.
