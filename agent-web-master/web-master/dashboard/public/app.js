/* web-master dashboard. No framework and no build step: the server serves this
   file, and everything below renders from api/data on this page. */
function pageUrl(path) {
  return new URL(String(path).replace(/^\//, ""), document.baseURI).href;
}

const PALETTE = ["#6ea8fe", "#4ade80", "#fbbf24", "#f472b6", "#a78bfa", "#22d3ee", "#fb923c", "#94a3b8"];
const state = { data: null, mode: "tokens", settings: null, open: new Set() };

const VIEWS = ["metrics", "settings"];
const el = (id) => document.getElementById(id);

/** Hash-routed tabs: #metrics or #settings, anything else falls back to metrics. */
function show() {
  const requested = location.hash.slice(1);
  const active = VIEWS.includes(requested) ? requested : "metrics";
  for (const view of VIEWS) el(`view-${view}`).hidden = view !== active;
  for (const link of document.querySelectorAll("#tabs a")) {
    if (link.dataset.view === active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}
const num = (value) => (value === null || value === undefined ? "—" : Number(value).toLocaleString("en-US"));
const money = (value) => (value === null || value === undefined ? "—" : `$${value >= 0.01 ? value.toFixed(4) : value.toFixed(6)}`);
const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const day = (iso) => (Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleDateString("en-CA") : "?");
const time = (iso) => (Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleTimeString("en-GB") : "?");
const datetime = (iso) => (Number.isFinite(Date.parse(iso)) ? `${day(iso)} ${time(iso)}` : "?");

function shortLabel(text) {
  const value = String(text ?? "");
  if (!value) return `<span class="muted">—</span>`;
  const clipped = value.length > 70 ? `${value.slice(0, 70)}…` : value;
  return `<span title="${esc(value)}">${esc(clipped)}</span>`;
}

function estCell(costEstimated, unrated) {
  if (unrated > 0) {
    return costEstimated > 0
      ? `${money(costEstimated)} <span class="origin mixed">+${unrated} unrated</span>`
      : `<span class="origin mixed">unrated</span>`;
  }
  return money(costEstimated);
}

function chartTitle() {
  return state.mode === "cost" ? "Estimated cost per day" : "Tokens per day";
}

function setLive(on) {
  const node = el("live");
  if (!node) return;
  node.textContent = on ? "live" : "offline";
  node.classList.toggle("off", !on);
}

async function load() {
  const response = await fetch(pageUrl("api/data"));
  if (!response.ok) throw new Error((await response.json()).error ?? "request failed");
  state.data = await response.json();
  render();
}

function render() {
  const data = state.data;
  if (!data) return;
  const calls = data.calls;
  const tokenTotal = calls.reduce((sum, call) => sum + call.total, 0);
  const estTotal = calls.reduce((sum, call) => sum + (call.costEstimated ?? 0), 0);
  const piTotal = calls.reduce((sum, call) => sum + (call.costPi ?? 0), 0);
  const unrated = calls.filter((call) => call.costEstimated === null).length;

  const tools = data.tools ?? [];
  const toolCost = tools.reduce((sum, tool) => sum + tool.costEstimated, 0);
  const searches = tools.reduce((sum, tool) => sum + tool.searches, 0);
  const toolsUnrated = tools.filter((tool) => tool.costStatus === "unrated" || tool.costStatus === "partial").length;

  el("summary").innerHTML = [
    card("tokens", num(tokenTotal), `${calls.length} calls · ${data.runs.length} runs`),
    card("estimated", money(estTotal + toolCost), `chat ${money(estTotal)} · tools ${money(toolCost)}${unrated ? ` · ${unrated} unrated` : ""}`),
    card("web searches", num(searches), `${tools.length} calls${toolsUnrated ? ` · ${toolsUnrated} unrated/partial` : ""}`),
    card("pi figure", money(piTotal), piTotal ? "chat turns only" : "no chat turns yet"),
  ].join("");

  el("rate-source").textContent = `rates: ${data.rates.source} · ${data.rates.version}`;
  el("tool-source").textContent = `tools: ${data.toolRates?.source ?? "?"} · ${data.toolRates?.version ?? "?"}`;
  renderChart(calls);
  renderTools(tools);
  renderTotals(data.totals);
  renderRuns(data.runs, calls);
  el("status").textContent = `updated ${new Date(data.generatedAt).toLocaleTimeString("en-GB")}`;
}

function card(label, value, sub) {
  return `<div class="card"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${esc(sub)}</div></div>`;
}

function series(calls, mode) {
  const days = new Map();
  for (const call of calls) {
    const key = `${call.provider}/${call.model}`;
    const date = day(call.startedAt);
    if (!days.has(date)) days.set(date, new Map());
    const bucket = days.get(date);
    const value = mode === "tokens" ? call.total : (call.costEstimated ?? 0);
    bucket.set(key, (bucket.get(key) ?? 0) + value);
  }
  return { days: [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])) };
}

function renderChart(calls) {
  const heading = el("chart-heading");
  if (heading) heading.textContent = chartTitle();
  const { days } = series(calls, state.mode);
  const keys = [...new Set(days.flatMap(([, bucket]) => [...bucket.keys()]))].sort();
  const colors = new Map(keys.map((key, index) => [key, PALETTE[index % PALETTE.length]]));
  el("legend").innerHTML = keys
    .map((key) => `<span><i style="background:${colors.get(key)}"></i>${esc(key)}</span>`)
    .join("");

  const width = 1000;
  const height = 220;
  const padLeft = 56;
  const padBottom = 22;
  const chartWidth = width - padLeft - 8;
  const chartHeight = height - padBottom - 8;

  if (days.length === 0) {
    el("chart").innerHTML = `<svg viewBox="0 0 ${width} ${height}"><text class="empty" x="${padLeft}" y="60">No calls yet.</text></svg>`;
    return;
  }

  const totalsPerDay = days.map(([, bucket]) => [...bucket.values()].reduce((sum, value) => sum + value, 0));
  const max = Math.max(...totalsPerDay, state.mode === "cost" ? 1e-6 : 1);
  const barWidth = Math.max(6, (chartWidth / days.length) * 0.62);
  const gap = chartWidth / days.length;

  let svg = `<svg viewBox="0 0 ${width} ${height}">`;
  for (let line = 0; line <= 4; line += 1) {
    const y = 8 + chartHeight - (chartHeight * line) / 4;
    const value = (max * line) / 4;
    svg += `<line class="axis" x1="${padLeft}" y1="${y}" x2="${width - 8}" y2="${y}" />`;
    svg += `<text class="tick" x="4" y="${y + 3}">${state.mode === "cost" ? money(value) : num(Math.round(value))}</text>`;
  }
  days.forEach(([date, bucket], index) => {
    const x = padLeft + gap * index + (gap - barWidth) / 2;
    let y = 8 + chartHeight;
    for (const key of keys) {
      const value = bucket.get(key) ?? 0;
      if (!value) continue;
      const slice = (value / max) * chartHeight;
      y -= slice;
      svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${Math.max(slice, 0.5)}" fill="${colors.get(key)}" opacity="0.85" />`;
    }
    svg += `<text class="tick" x="${x + barWidth / 2}" y="${height - 6}" text-anchor="middle">${date.slice(5)}</text>`;
  });
  svg += "</svg>";
  el("chart").innerHTML = svg;
}

function renderTools(tools) {
  const head = `<tr><th>when</th><th>tool</th><th>providers</th><th class="num">searches</th><th class="num">urls</th><th class="num">results</th><th class="num">est</th><th>status</th><th class="num">ms</th></tr>`;
  const rows = tools
    .map((tool) => {
      const providers = Object.entries(tool.providers || {})
        .map(([name, count]) => `${esc(name)}×${count}`)
        .join(", ");
      const flag = tool.costStatus === "rated" ? "" : ` <span class="origin mixed">${esc(tool.costStatus)}</span>`;
      return `<tr><td>${datetime(tool.startedAt)}</td><td>${esc(tool.tool)}</td><td>${providers || "unknown"}</td><td class="num">${num(tool.searches)}</td><td class="num">${num(tool.urls)}</td><td class="num">${num(tool.results)}</td><td class="num">${money(tool.costEstimated)}${flag}</td><td>${esc(tool.status)}</td><td class="num">${num(tool.durationMs)}</td></tr>`;
    })
    .join("");
  el("tools").innerHTML = head + (rows || `<tr><td colspan="9" class="muted">No web searches yet.</td></tr>`);
}

function renderTotals(totals) {
  const head = `<tr><th>model</th><th class="num">calls</th><th class="num">total</th><th class="num">input</th><th class="num">cached</th><th class="num">cache write</th><th class="num">output</th><th class="num">reasoning</th><th class="num">est</th><th class="num">pi</th></tr>`;
  const rows = totals
    .map((row) => {
      const est = estCell(row.costEstimated, row.unrated ?? 0);
      return `<tr><td>${esc(row.provider)}/${esc(row.model)}</td><td class="num">${num(row.calls)}</td><td class="num">${num(row.tokens.total)}</td><td class="num">${num(row.tokens.input)}</td><td class="num">${num(row.tokens.cacheRead)}</td><td class="num">${num(row.tokens.cacheWrite)}</td><td class="num">${num(row.tokens.output)}</td><td class="num">${num(row.tokens.reasoning)}</td><td class="num">${est}</td><td class="num">${money(row.costPi)}</td></tr>`;
    })
    .join("");
  el("totals").innerHTML = head + (rows || `<tr><td colspan="10" class="muted">No calls yet.</td></tr>`);
}

function renderRuns(runs, calls) {
  const byRun = new Map();
  for (const call of calls) {
    if (!byRun.has(call.runId)) byRun.set(call.runId, []);
    byRun.get(call.runId).push(call);
  }
  const head = `<tr><th>when</th><th>origin</th><th>input</th><th class="num">calls</th><th class="num">tokens</th><th class="num">est</th><th class="num">pi</th><th class="num">ms</th></tr>`;
  const rows = [...runs]
    .reverse()
    .map((run) => {
      const open = state.open.has(run.runId);
      const origin = esc(run.origin);
      const cells = `<tr class="run" data-run="${esc(run.runId)}"><td>${datetime(run.startedAt)}</td><td><span class="origin ${origin}">${origin}</span></td><td>${shortLabel(run.label)}</td><td class="num">${run.calls}</td><td class="num">${num(run.totalTokens)}</td><td class="num">${estCell(run.costEstimated, run.unrated ?? 0)}</td><td class="num">${money(run.costPi)}</td><td class="num">${num(run.durationMs)}</td></tr>`;
      if (!open) return cells;
      const detail = (byRun.get(run.runId) ?? [])
        .map((call) => {
          const callOrigin = esc(call.origin);
          return `<tr><td>${datetime(call.startedAt)}</td><td>${callOrigin}</td><td>${esc(call.provider)}/${esc(call.model)}</td><td class="num">${num(call.input)}</td><td class="num">${num(call.cacheRead)}</td><td class="num">${num(call.cacheWrite)}</td><td class="num">${num(call.output)}</td><td class="num">${num(call.reasoning)}</td><td class="num">${num(call.total)}</td><td class="num">${money(call.costEstimated)}</td><td class="num">${money(call.costPi)}</td><td class="num">${num(call.durationMs)}</td></tr>`;
        })
        .join("");
      return `${cells}<tr class="calls"><td colspan="8"><table><tr><th>when</th><th>origin</th><th>model</th><th class="num">in</th><th class="num">cached</th><th class="num">cache write</th><th class="num">out</th><th class="num">reasoning</th><th class="num">total</th><th class="num">est</th><th class="num">pi</th><th class="num">ms</th></tr>${detail}</table></td></tr>`;
    })
    .join("");
  el("runs").innerHTML = head + (rows || `<tr><td colspan="8" class="muted">No runs yet.</td></tr>`);
  for (const row of document.querySelectorAll("tr.run")) {
    row.addEventListener("click", () => {
      const id = row.dataset.run;
      if (state.open.has(id)) state.open.delete(id);
      else state.open.add(id);
      render();
    });
  }
}

async function loadSettings() {
  const response = await fetch(pageUrl("api/settings"));
  if (!response.ok) throw new Error((await response.json()).error ?? "request failed");
  state.settings = await response.json();
  const { current, models, effortLevels } = state.settings;
  const provider = el("provider");
  provider.innerHTML = [...new Set(models.map((model) => model.provider))]
    .map((name) => `<option value="${esc(name)}">${esc(name)}</option>`)
    .join("");
  if (current) provider.value = current.provider;
  fillModels();
  el("effort").innerHTML = effortLevels.map((level) => `<option>${level}</option>`).join("");
  if (current?.effort) el("effort").value = current.effort;
  const sourceNote = state.settings.source === "settings" ? " (from settings.json)" : "";
  el("default-model").textContent = current
    ? `next launch: ${current.provider}/${current.model} · effort ${current.effort}${sourceNote}`
    : "next launch: no default saved";
}

function fillModels() {
  const provider = el("provider").value;
  const models = state.settings.models.filter((model) => model.provider === provider);
  const current = state.settings.current;
  const preferred = current && current.provider === provider ? current.model : el("model").value;
  el("model").innerHTML = models
    .map(
      (model) =>
        `<option value="${esc(model.id)}">${esc(model.id)} — ${esc(model.name)}${model.cost ? ` · $${model.cost.input}/$${model.cost.output}` : ""}</option>`,
    )
    .join("");
  if (models.some((model) => model.id === preferred)) {
    el("model").value = preferred;
    return true;
  }
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Choose a model";
  el("model").prepend(blank);
  el("model").value = "";
  return false;
}

async function save() {
  const provider = el("provider");
  const model = el("model");
  const effort = el("effort");
  if (!model.value) {
    el("save-state").textContent = "Choose a model for this provider.";
    return;
  }
  el("save-state").textContent = "saving…";
  provider.disabled = true;
  model.disabled = true;
  effort.disabled = true;
  try {
    const response = await fetch(pageUrl("api/settings"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: provider.value, model: model.value, effort: effort.value }),
    });
    const result = await response.json();
    if (!response.ok) {
      el("save-state").textContent = result.error ?? "Could not save.";
      await loadSettings();
      return;
    }
    el("save-state").textContent = `saved · ${result.note}`;
    await loadSettings();
  } catch (error) {
    el("save-state").textContent = error instanceof Error ? error.message : "Could not save.";
  } finally {
    provider.disabled = false;
    model.disabled = false;
    effort.disabled = false;
  }
}

/* ---------- web search route ---------- */

const routeState = { providers: [], known: [], workflow: "none" };

function markerFor(name) {
  const known = routeState.known.find((entry) => entry.name === name);
  if (!known) return `<span class="marker off">unknown</span>`;
  if (!known.configured) return `<span class="marker off">${esc(known.note)}</span>`;
  if (known.note === "key found") return `<span class="marker ok">key</span>`;
  return `<span class="marker free">${esc(known.note)}</span>`;
}

function renderRoute() {
  el("route").innerHTML =
    routeState.providers
      .map(
        (name, index) => `<li>
      <span class="step">${index + 1}</span>
      <span class="name">${esc(name)}</span>
      ${markerFor(name)}
      <span style="flex:1"></span>
      <button data-act="up" data-name="${esc(name)}" ${index === 0 ? "disabled" : ""}>↑</button>
      <button data-act="down" data-name="${esc(name)}" ${index === routeState.providers.length - 1 ? "disabled" : ""}>↓</button>
      <button data-act="remove" data-name="${esc(name)}">×</button>
    </li>`,
      )
      .join("") || `<li class="muted">No providers — add one below.</li>`;
  for (const button of el("route").querySelectorAll("button")) {
    button.addEventListener("click", () => moveRoute(button.dataset.act, button.dataset.name));
  }
}

function refreshAdd() {
  el("route-add").innerHTML = routeState.known
    .filter((entry) => !routeState.providers.includes(entry.name))
    .map((entry) => `<option value="${esc(entry.name)}">${esc(entry.name)}${entry.configured ? "" : " — no key"}</option>`)
    .join("");
}

function moveRoute(action, name) {
  const index = routeState.providers.indexOf(name);
  if (index === -1) return;
  if (action === "remove") routeState.providers.splice(index, 1);
  if (action === "up" && index > 0) {
    [routeState.providers[index - 1], routeState.providers[index]] = [routeState.providers[index], routeState.providers[index - 1]];
  }
  if (action === "down" && index < routeState.providers.length - 1) {
    [routeState.providers[index + 1], routeState.providers[index]] = [routeState.providers[index], routeState.providers[index + 1]];
  }
  renderRoute();
  refreshAdd();
}

async function loadRoute() {
  const data = await (await fetch(pageUrl("api/search-route"))).json();
  routeState.providers = [...(data.providers ?? [])];
  routeState.known = data.known ?? [];
  routeState.workflow = data.workflow ?? "none";
  el("workflow").value = routeState.workflow;
  el("route-state").textContent = data.error ?? "";
  renderRoute();
  refreshAdd();
}

async function saveRoute() {
  el("route-state").textContent = "saving…";
  const response = await fetch(pageUrl("api/search-route"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providers: routeState.providers, workflow: el("workflow").value }),
  });
  const result = await response.json();
  el("route-state").textContent = response.ok ? `saved · ${result.note}` : result.error;
  if (response.ok) await loadRoute();
}

/* ---------- prices ---------- */

function ratesRow(cells) {
  return `<tr>${cells.map((cell, index) => `<td class="${index === 0 ? "" : "num"}">${cell}</td>`).join("")}</tr>`;
}

async function loadRates() {
  const data = await (await fetch(pageUrl("api/rates"))).json();
  const models = Object.entries(data.models.entries ?? {});
  el("rates-models").innerHTML =
    `<tr><th>model</th><th class="num">in /1M</th><th class="num">out /1M</th><th class="num">cache read</th><th class="num">versions</th><th>latest from</th></tr>` +
    (models
      .map(([id, entries]) => {
        const latest = entries[entries.length - 1];
        return ratesRow([esc(id), latest.input, latest.output, latest.cacheRead, entries.length, esc(String(latest.effectiveFrom).slice(0, 10))]);
      })
      .join("") || `<tr><td colspan="6" class="muted">No prices in the card.</td></tr>`);
  el("rates-models-note").textContent = `source: ${data.models.source} · version ${data.models.version}${data.models.unrated.length ? ` · unrated: ${data.models.unrated.join(", ")}` : ""}`;

  const providers = Object.entries(data.tools.providers ?? {});
  el("rates-tools").innerHTML =
    `<tr><th>provider</th><th class="num">per search</th><th>tokens</th></tr>` +
    (providers
      .map(([name, rate]) =>
        ratesRow([esc(name), `$${rate.perSearch}`, rate.tokensUnmetered ? "unmetered" : "counted"]),
      )
      .join("") || `<tr><td colspan="3" class="muted">No prices in the card.</td></tr>`);
  el("rates-tools-note").textContent = `source: ${data.tools.source} · version ${data.tools.version} · fetch $${data.tools.fetch.perUrl}/url${data.tools.unrated.length ? ` · unrated: ${data.tools.unrated.join(", ")}` : ""}`;
}

el("provider").addEventListener("change", () => {
  el("save-state").textContent = fillModels() ? "" : "Choose a model for this provider.";
});
el("model").addEventListener("change", () => void save());
el("effort").addEventListener("change", () => void save());
el("route-add-btn").addEventListener("click", () => {
  const name = el("route-add").value;
  if (!name || routeState.providers.includes(name)) return;
  routeState.providers.push(name);
  renderRoute();
  refreshAdd();
});
el("route-save").addEventListener("click", () => void saveRoute());
for (const button of document.querySelectorAll("#series-mode button")) {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    for (const other of document.querySelectorAll("#series-mode button")) other.classList.toggle("on", other === button);
    renderChart(state.data?.calls ?? []);
  });
}

const events = new EventSource(pageUrl("api/events"));
let timer = null;
let loaded = false;
events.addEventListener("open", () => setLive(true));
events.addEventListener("error", () => setLive(false));
events.addEventListener("update", (event) => {
  clearTimeout(timer);
  let reason = "data";
  try {
    reason = JSON.parse(event.data)?.reason ?? "data";
  } catch {
    reason = "data";
  }
  timer = setTimeout(() => {
    if (reason === "settings") void loadSettings().catch(() => {});
    else void load();
  }, 250);
});
events.addEventListener("ready", () => {
  setLive(true);
  if (!loaded) return;
  void load();
});

window.addEventListener("hashchange", show);
show();

void loadSettings().catch((error) => {
  el("save-state").textContent = error instanceof Error ? error.message : "Could not load settings.";
});
void loadRoute();
void loadRates();
void load()
  .then(() => {
    loaded = true;
  })
  .catch((error) => {
    el("status").textContent = error instanceof Error ? error.message : "dashboard unavailable";
  });
