/* template-new-agent dashboard. No framework and no build step: the server serves this
   file, and everything below renders from /api/data. */

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

async function load() {
  const response = await fetch("/api/data");
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

  el("summary").innerHTML = [
    card("tokens", num(tokenTotal), `${calls.length} calls · ${data.runs.length} runs`),
    card("estimated", money(estTotal), unrated ? `${unrated} unrated calls` : "rate card applied"),
    card("pi figure", money(piTotal), piTotal ? "chat turns only" : "no chat turns yet"),
    card("delta", money(Math.abs(estTotal - piTotal)), "est vs pi"),
  ].join("");

  el("rate-source").textContent = `rate card: ${data.rates.source} · ${data.rates.version}${data.rates.error ? ` · ${data.rates.error}` : ""}`;
  renderChart(calls);
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
  const max = Math.max(...totalsPerDay, 1);
  const barWidth = Math.max(6, (chartWidth / days.length) * 0.62);
  const gap = chartWidth / days.length;

  let svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`;
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

function renderTotals(totals) {
  const head = `<tr><th>model</th><th class="num">calls</th><th class="num">total</th><th class="num">input</th><th class="num">cached</th><th class="num">output</th><th class="num">est</th><th class="num">pi</th></tr>`;
  const rows = totals
    .map(
      (row) =>
        `<tr><td>${esc(row.provider)}/${esc(row.model)}</td><td class="num">${num(row.calls)}</td><td class="num">${num(row.tokens.total)}</td><td class="num">${num(row.tokens.input)}</td><td class="num">${num(row.tokens.cacheRead)}</td><td class="num">${num(row.tokens.output)}</td><td class="num">${money(row.costEstimated)}</td><td class="num">${money(row.costPi)}</td></tr>`,
    )
    .join("");
  el("totals").innerHTML = head + (rows || `<tr><td colspan="8" class="muted">No calls yet.</td></tr>`);
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
      const cells = `<tr class="run" data-run="${esc(run.runId)}"><td>${time(run.startedAt)}</td><td><span class="origin ${run.origin}">${run.origin}</span></td><td>${esc(run.label.slice(0, 70)) || "<span class='muted'>—</span>"}</td><td class="num">${run.calls}</td><td class="num">${num(run.totalTokens)}</td><td class="num">${money(run.costEstimated)}</td><td class="num">${money(run.costPi)}</td><td class="num">${num(run.durationMs)}</td></tr>`;
      if (!open) return cells;
      const detail = (byRun.get(run.runId) ?? [])
        .map(
          (call) =>
            `<tr><td>${time(call.startedAt)}</td><td>${call.origin}</td><td>${esc(call.provider)}/${esc(call.model)}</td><td class="num">${num(call.input)}</td><td class="num">${num(call.cacheRead)}</td><td class="num">${num(call.output)}</td><td class="num">${num(call.reasoning)}</td><td class="num">${num(call.total)}</td><td class="num">${money(call.costEstimated)}</td><td class="num">${money(call.costPi)}</td><td class="num">${num(call.durationMs)}</td></tr>`,
        )
        .join("");
      return `${cells}<tr class="calls"><td colspan="8"><table><tr><th>when</th><th>origin</th><th>model</th><th class="num">in</th><th class="num">cached</th><th class="num">out</th><th class="num">reasoning</th><th class="num">total</th><th class="num">est</th><th class="num">pi</th><th class="num">ms</th></tr>${detail}</table></td></tr>`;
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
  const response = await fetch("/api/settings");
  state.settings = await response.json();
  const { current, models, thinkingLevels } = state.settings;
  const provider = el("provider");
  provider.innerHTML = [...new Set(models.map((model) => model.provider))]
    .map((name) => `<option value="${esc(name)}">${esc(name)}</option>`)
    .join("");
  if (current) provider.value = current.provider;
  fillModels();
  el("thinking").innerHTML = thinkingLevels.map((level) => `<option>${level}</option>`).join("");
  if (current?.thinking) el("thinking").value = current.thinking;
  el("default-model").textContent = current
    ? `next launch: ${current.provider}/${current.model} · effort ${current.thinking}`
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
  const thinking = el("thinking");
  if (!model.value) {
    el("save-state").textContent = "Choose a model for this provider.";
    return;
  }
  el("save-state").textContent = "saving…";
  provider.disabled = true;
  model.disabled = true;
  thinking.disabled = true;
  try {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: provider.value, model: model.value, thinking: thinking.value }),
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
    thinking.disabled = false;
  }
}

el("provider").addEventListener("change", () => {
  el("save-state").textContent = fillModels() ? "" : "Choose a model for this provider.";
});
el("model").addEventListener("change", () => void save());
el("thinking").addEventListener("change", () => void save());
for (const button of document.querySelectorAll("#series-mode button")) {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    for (const other of document.querySelectorAll("#series-mode button")) other.classList.toggle("on", other === button);
    renderChart(state.data?.calls ?? []);
  });
}

const events = new EventSource("/api/events");
let timer = null;
events.addEventListener("update", () => {
  clearTimeout(timer);
  timer = setTimeout(() => void load(), 250);
});
events.addEventListener("ready", () => void load());

window.addEventListener("hashchange", show);
show();

void loadSettings();
void load().catch((error) => {
  el("status").textContent = error instanceof Error ? error.message : "dashboard unavailable";
});
