import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentDir, ledgerPath, modelsStorePath, repoRoot, sessionsRoot } from "../ledger/env.ts";
import { readRates } from "../ledger/rates.ts";
import type { RatesSnapshot } from "../ledger/rate-table.ts";
import { syncSessions } from "../ledger/ingest.ts";
import { syncToolCalls } from "../ledger/search-ingest.ts";
import { readToolRates } from "../ledger/tool-rates.ts";
import { readToolCalls } from "../ledger/tool-store.ts";
import { openLedger, readCalls, type Ledger } from "../ledger/store.ts";
import { summarizeRuns, tokensOfCall, totalsByModel, type RunSummary } from "../ledger/runs.ts";
import { estimateCost } from "../ledger/tokens.ts";
import { readDefaultModel, THINKING_LEVELS, writeDefaultModel } from "../src/default-model.ts";

const DEFAULT_PORT = 8789;
const DEFAULT_ORIGINS = [`http://127.0.0.1:${DEFAULT_PORT}`, `http://localhost:${DEFAULT_PORT}`];
const PUBLIC_DIR = path.join(import.meta.dirname, "public");
const MAX_BODY = 8_192;

export interface DashboardOptions {
  /**
   * Agent home: holds sessions, logs and default-web-master-model.json. Defaults to the
   * folder this file lives in, one level up, so an unrelated PI_CODING_AGENT_DIR
   * in the shell cannot point the dashboard at the wrong ledger.
   */
  root?: string;
  host?: string;
  port?: number;
  origins?: string[];
  /** How often an open page is told to look again. */
  pollMs?: number;
}

export interface Dashboard {
  server: Server;
  close(): Promise<void>;
}

export function startDashboard(options: DashboardOptions = {}): Dashboard {
  const root = options.root ?? process.env.DASHBOARD_ROOT ?? path.join(import.meta.dirname, "..");
  const env: NodeJS.ProcessEnv = { ...process.env, PI_CODING_AGENT_DIR: root };
  const host = options.host ?? process.env.DASHBOARD_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.DASHBOARD_PORT ?? DEFAULT_PORT);
  const origins = options.origins ?? (process.env.DASHBOARD_ORIGIN?.split(",").map((o) => o.trim()) ?? DEFAULT_ORIGINS);
  const pollMs = options.pollMs ?? 2_000;
  const watchers = new Set<ServerResponse>();
  let ledger: Ledger | null = null;

  const openOnce = (): Ledger => (ledger ??= openLedger(ledgerPath(env)));

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "Dashboard request failed." });
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
    const origin = request.headers.origin;

    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders(origin, origins));
      response.end();
      return;
    }
    if (origin && !origins.includes(origin)) {
      sendJson(response, 403, { error: `Origin ${origin} is not allowed. Add it to DASHBOARD_ORIGIN.` }, corsHeaders(origin, origins));
      return;
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      await sendFile(response, "index.html", "text/html; charset=utf-8", origin, origins);
      return;
    }
    if (request.method === "GET" && (url.pathname === "/app.js" || url.pathname === "/style.css")) {
      const type = url.pathname.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8";
      await sendFile(response, url.pathname.slice(1), type, origin, origins);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/data") {
      const rates = await readRates(env);
      const store = openOnce();
      sync(rates.version);
      const toolRates = await readToolRates(env);
      syncTools(toolRates);
      const runs = summarizeRuns(store, rates);
      const calls = callsPayload(runs, rates);
      const tools = toolPayload(readToolCalls(store, toolRates));
      const unmetered = tools.filter((tool) => tool.costStatus !== "rated").length;
      sendJson(response, 200, {
        generatedAt: new Date().toISOString(),
        rates: { source: rates.source, version: rates.version, updatedAt: rates.updatedAt, ...(rates.error ? { error: rates.error } : {}) },
        calls,
        tools,
        toolRates: {
          source: toolRates.source,
          version: toolRates.version,
          ...(toolRates.error ? { error: toolRates.error } : {}),
          unmeteredCalls: unmetered,
        },
        totals: totalsByModel(runs, rates),
        runs: runs.map((run) => ({
          runId: run.runId,
          startedAt: run.startedAt,
          label: run.label,
          origin: run.origin,
          sessionId: run.sessionId,
          totalTokens: run.tokens.total,
          costEstimated: run.costEstimated,
          costPi: run.costPi,
          durationMs: run.durationMs,
          calls: run.calls.length,
        })),
      }, corsHeaders(origin, origins));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/settings") {
      const current = await readDefaultModel(env).catch(() => null);
      sendJson(response, 200, {
        current,
        effortLevels: THINKING_LEVELS,
        models: await catalog(env),
      }, corsHeaders(origin, origins));
      return;
    }

    if (request.method === "PUT" && url.pathname === "/api/settings") {
      const body = await readBody(request);
      const parsed = JSON.parse(body) as { provider?: unknown; model?: unknown; effort?: unknown };
      const provider = String(parsed.provider ?? "").trim();
      const model = String(parsed.model ?? "").trim();
      const effort = String(parsed.effort ?? "low").trim();
      const models = await catalog(env);
      const known = models.some((entry) => entry.provider === provider && entry.id === model);
      if (!known) {
        sendJson(response, 400, { error: `${provider}/${model} is not in the provider catalog.` }, corsHeaders(origin, origins));
        return;
      }
      if (!THINKING_LEVELS.includes(effort as (typeof THINKING_LEVELS)[number])) {
        sendJson(response, 400, { error: `Unknown effort "${effort}".` }, corsHeaders(origin, origins));
        return;
      }
      const saved = await writeDefaultModel({ provider, model, effort }, env);
      broadcast("settings");
      sendJson(response, 200, { saved, note: "Applies to the next launch." }, corsHeaders(origin, origins));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/search-route") {
      const config = await readSearchConfig(env);
      sendJson(response, 200, {
        providers: config.providers,
        workflow: config.workflow,
        fallbackOn: config.fallbackOn,
        known: KNOWN_PROVIDERS.map((name) => ({
          name,
          ...availability(name, config.keyNames),
        })),
        ...(config.error ? { error: config.error } : {}),
      }, corsHeaders(origin, origins));
      return;
    }

    if (request.method === "PUT" && url.pathname === "/api/search-route") {
      const body = JSON.parse(await readBody(request)) as { providers?: unknown; workflow?: unknown };
      const providers = Array.isArray(body.providers) ? body.providers.map((name) => String(name).trim()) : [];
      if (providers.length === 0) {
        sendJson(response, 400, { error: "The route needs at least one provider." }, corsHeaders(origin, origins));
        return;
      }
      const unknown = providers.filter((name) => !KNOWN_PROVIDERS.includes(name));
      if (unknown.length > 0) {
        sendJson(response, 400, { error: `Unknown provider(s): ${unknown.join(", ")}.` }, corsHeaders(origin, origins));
        return;
      }
      if (new Set(providers).size !== providers.length) {
        sendJson(response, 400, { error: "A provider appears twice in the route." }, corsHeaders(origin, origins));
        return;
      }
      const workflow = body.workflow === undefined ? undefined : String(body.workflow);
      if (workflow !== undefined && !WORKFLOWS.includes(workflow)) {
        sendJson(response, 400, { error: `Unknown workflow "${workflow}".` }, corsHeaders(origin, origins));
        return;
      }
      const saved = await writeSearchConfig(env, { providers, workflow });
      sendJson(response, 200, { saved, note: "Applies to the next search." }, corsHeaders(origin, origins));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/rates") {
      const modelRates = await readRates(env);
      const toolRates = await readToolRates(env);
      const store = openOnce();
      sync(modelRates.version);
      syncTools(toolRates);
      const usedModels = [...new Set(readCalls(store).map((call) => call.modelRequested))].filter((id) => id !== "");
      const toolCalls = readToolCalls(store, toolRates);
      const usedProviders = [...new Set(toolCalls.flatMap((call) => Object.keys(call.providerCounts)))];
      sendJson(response, 200, {
        models: {
          source: modelRates.source,
          version: modelRates.version,
          updatedAt: modelRates.updatedAt,
          entries: modelRates.models,
          unrated: usedModels.filter((id) => !modelRates.models[id]),
          ...(modelRates.error ? { error: modelRates.error } : {}),
        },
        tools: {
          source: toolRates.source,
          version: toolRates.version,
          providers: toolRates.providers,
          fetch: toolRates.fetch,
          unrated: usedProviders.filter((name) => !toolRates.providers[name]),
          ...(toolRates.error ? { error: toolRates.error } : {}),
        },
      }, corsHeaders(origin, origins));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/events") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        ...corsHeaders(origin, origins),
      });
      response.write("event: ready\ndata: {}\n\n");
      watchers.add(response);
      request.on("close", () => watchers.delete(response));
      return;
    }

    sendJson(response, 404, { error: `No route for ${url.pathname}.` }, corsHeaders(origin, origins));
  }

  function sync(ratesVersion: string): void {
    try {
      syncSessions(openOnce(), { sessionsRoot: sessionsRoot(env), ratesVersion });
    } catch {
      // A half-written session file must not take the dashboard down.
    }
  }

  function syncTools(rates: Awaited<ReturnType<typeof readToolRates>>): void {
    try {
      syncToolCalls(openOnce(), { sessionsRoot: sessionsRoot(env), rates });
    } catch {
      // Same rule as sessions: a bad file is not allowed to break the page.
    }
  }

  function broadcast(reason: string): void {
    for (const watcher of watchers) {
      try {
        watcher.write(`event: update\ndata: ${JSON.stringify({ reason, at: new Date().toISOString() })}\n\n`);
      } catch {
        watchers.delete(watcher);
      }
    }
  }

  const heartbeat = setInterval(() => {
    for (const watcher of watchers) {
      try {
        watcher.write(": ping\n\n");
      } catch {
        watchers.delete(watcher);
      }
    }
  }, pollMs);
  heartbeat.unref();

  server.on("error", (error: NodeJS.ErrnoException) => {
    // A second dashboard on the same port is a normal mistake, not a stack trace.
    if (error.code === "EADDRINUSE") {
      process.stderr.write(
        `web-master dashboard: ${host}:${port} is already in use. Stop the other dashboard, or set DASHBOARD_PORT.\n`,
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  });

  server.listen(port, host);

  return {
    server,
    async close() {
      clearInterval(heartbeat);
      for (const watcher of watchers) watcher.end();
      watchers.clear();
      ledger?.close();
      ledger = null;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

interface CallPayload {
  callId: string;
  runId: string;
  runLabel: string;
  startedAt: string;
  origin: string;
  provider: string;
  model: string;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning: number | null;
  total: number;
  costEstimated: number | null;
  costPi: number | null;
  durationMs: number | null;
  status: string;
  sessionId: string | null;
}

function callsPayload(runs: RunSummary[], rates: RatesSnapshot): CallPayload[] {
  const out: CallPayload[] = [];
  for (const run of runs) {
    for (const call of run.calls) {
      const estimate = estimateCost(tokensOfCall(call), call.modelRequested, rates, call.startedAt);
      out.push({
        callId: call.callId,
        runId: call.runId,
        runLabel: run.label,
        startedAt: call.startedAt,
        origin: call.origin,
        provider: call.provider,
        model: call.modelRequested,
        input: call.input,
        cacheRead: call.cacheRead,
        cacheWrite: call.cacheWrite,
        output: call.output,
        reasoning: call.reasoning,
        total: call.totalTokens,
        costEstimated: estimate ? estimate.total : null,
        costPi: call.costPi,
        durationMs: call.durationMs,
        status: call.status,
        sessionId: call.sessionId,
      });
    }
  }
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export interface ToolPayload {
  callId: string;
  runId: string | null;
  startedAt: string;
  tool: string;
  kind: string;
  searches: number;
  urls: number;
  results: number;
  durationMs: number | null;
  providers: Record<string, number>;
  costEstimated: number;
  costStatus: string;
  status: string;
}

function toolPayload(rows: ReturnType<typeof readToolCalls>): ToolPayload[] {
  return rows.map((row) => ({
    callId: row.callId,
    runId: row.runId,
    startedAt: row.startedAt,
    tool: row.tool,
    kind: row.kind,
    searches: row.searches,
    urls: row.urls,
    results: row.results,
    durationMs: row.durationMs,
    providers: row.providerCounts,
    costEstimated: row.costEstimated,
    costStatus: row.costStatus,
    status: row.status,
  }));
}

/** Providers the dashboard will offer. Only these can be written into the route. */
const KNOWN_PROVIDERS = ["brave", "perplexity", "exa", "tavily", "gemini", "openai", "duckduckgo", "searxng"];
const WORKFLOWS = ["none", "summary-review", "auto-summary"];

/** Which env name a provider needs. `null` means it needs no credential. */
const KEY_FOR: Record<string, string | null> = {
  brave: "BRAVE_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  exa: "EXA_API_KEY",
  tavily: "TAVILY_API_KEY",
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  duckduckgo: null,
  searxng: "SEARXNG_URL",
};

interface SearchConfig {
  providers: string[];
  workflow: string;
  fallbackOn: string[];
  keyNames: Set<string>;
  error?: string;
}

/**
 * Key presence is read from the `.env` file's **names only** — the dashboard never reads or
 * holds a value. That is why the route editor can say "no key" without a key being present.
 */
async function envKeyNames(env: NodeJS.ProcessEnv): Promise<Set<string>> {
  const names = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== "") names.add(key);
  }
  try {
    const text = await readFile(`${repoRoot(env)}/.env`, "utf8");
    for (const line of text.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (match && match[2].trim() !== "") names.add(match[1]);
    }
  } catch {
    // No .env: process environment is the only source.
  }
  return names;
}

async function readSearchConfig(env: NodeJS.ProcessEnv): Promise<SearchConfig> {
  const keyNames = await envKeyNames(env);
  const file = `${agentDir(env)}/web-search.json`;
  let parsed: Record<string, unknown> = {};
  let error: string | undefined;
  try {
    parsed = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") error = `web-search.json: ${(cause as Error).message}`;
  }
  const routing = (parsed.searchRouting ?? {}) as Record<string, unknown>;
  const listed = Array.isArray(routing.providers) ? routing.providers.filter((name): name is string => typeof name === "string") : [];
  const workflow = typeof parsed.workflow === "string" ? parsed.workflow : "none";
  const fallbackOn = Array.isArray(routing.fallbackOn) ? routing.fallbackOn.filter((name): name is string => typeof name === "string") : [];
  return { providers: listed, workflow, fallbackOn, keyNames, ...(error ? { error } : {}) };
}

/** Writes only `searchRouting.providers` and `workflow`; every other key is preserved. */
async function writeSearchConfig(
  env: NodeJS.ProcessEnv,
  change: { providers: string[]; workflow?: string },
): Promise<{ providers: string[]; workflow: string }> {
  const file = `${agentDir(env)}/web-search.json`;
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    existing = {};
  }
  const routing = { ...(existing.searchRouting as Record<string, unknown> | undefined) } as Record<string, unknown>;
  routing.providers = change.providers;
  const workflow = change.workflow ?? (typeof existing.workflow === "string" ? existing.workflow : "none");
  const next = { ...existing, workflow, searchRouting: routing };
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { providers: change.providers, workflow };
}

function availability(name: string, keyNames: Set<string>): { configured: boolean; needs: string | null; note: string } {
  const needs = KEY_FOR[name] ?? null;
  if (needs === null) {
    return { configured: true, needs, note: name === "duckduckgo" ? "free, explicit only" : "no credential" };
  }
  const configured = keyNames.has(needs);
  if (configured) return { configured, needs, note: "key found" };
  if (name === "exa") return { configured: true, needs, note: "keyless MCP" };
  return { configured: false, needs, note: "no key" };
}

interface CatalogModel {
  provider: string;
  id: string;
  name: string;
  contextWindow: number | null;
  cost: { input: number; output: number; cacheRead: number } | null;
}

/** The models the dashboard may offer: whatever Pi's cached catalog knows. */
async function catalog(env: NodeJS.ProcessEnv): Promise<CatalogModel[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(modelsStorePath(env), "utf8")) as unknown;
  } catch {
    return [];
  }
  const models: CatalogModel[] = [];
  for (const [provider, value] of Object.entries(parsed as Record<string, { models?: unknown }>)) {
    if (!Array.isArray(value.models)) continue;
    for (const entry of value.models) {
      const model = entry as { id?: unknown; name?: unknown; contextWindow?: unknown; cost?: Record<string, unknown> };
      if (typeof model.id !== "string") continue;
      models.push({
        provider,
        id: model.id,
        name: typeof model.name === "string" ? model.name : model.id,
        contextWindow: typeof model.contextWindow === "number" ? model.contextWindow : null,
        cost: model.cost
          ? {
              input: number(model.cost.input),
              output: number(model.cost.output),
              cacheRead: number(model.cost.cacheRead),
            }
          : null,
      });
    }
  }
  return models;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function sendFile(
  response: ServerResponse,
  file: string,
  type: string,
  origin: string | undefined,
  origins: string[],
): Promise<void> {
  const resolved = path.resolve(PUBLIC_DIR, file);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendJson(response, 403, { error: "No." });
    return;
  }
  try {
    const body = await readFile(resolved);
    response.writeHead(200, { "content-type": type, "cache-control": "no-store", ...corsHeaders(origin, origins) });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: `${file} is missing.` });
  }
}

function corsHeaders(origin: string | undefined, origins: string[]): Record<string, string> {
  if (!origin || !origins.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, PUT, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(text);
}

async function readBody(request: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const dashboard = startDashboard();
  const announce = (): void => {
    const address = dashboard.server.address();
    const bound = typeof address === "object" && address ? address.port : DEFAULT_PORT;
    write(`web-master dashboard on http://127.0.0.1:${bound}\n`);
  };
  if (dashboard.server.listening) announce();
  else dashboard.server.once("listening", announce);
}

function write(text: string): void {
  process.stderr.write(text);
}
