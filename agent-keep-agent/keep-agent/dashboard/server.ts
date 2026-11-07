import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ledgerPath, modelsStorePath, sessionsRoot } from "../ledger/env.ts";
import { readRates } from "../ledger/rates.ts";
import type { RatesSnapshot } from "../ledger/rate-table.ts";
import { syncSessions } from "../ledger/ingest.ts";
import { openLedger, readCalls, type Ledger } from "../ledger/store.ts";
import { summarizeRuns, tokensOfCall, totalsByModel, type RunSummary } from "../ledger/runs.ts";
import { estimateCost } from "../ledger/tokens.ts";
import { readDefaultModel, THINKING_LEVELS, writeDefaultModel } from "../src/default-model.ts";

const DEFAULT_ORIGINS = ["http://127.0.0.1:8790", "http://localhost:8790"];
const PUBLIC_DIR = path.join(import.meta.dirname, "public");
const MAX_BODY = 8_192;

export interface DashboardOptions {
  /**
   * Agent home: holds sessions, logs and default-model.json. Defaults to the
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
  const port = options.port ?? Number(process.env.DASHBOARD_PORT ?? 8790);
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
      const runs = summarizeRuns(store, rates);
      sendJson(response, 200, {
        generatedAt: new Date().toISOString(),
        rates: { source: rates.source, version: rates.version, updatedAt: rates.updatedAt, ...(rates.error ? { error: rates.error } : {}) },
        calls: callsPayload(runs, rates),
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
        thinkingLevels: THINKING_LEVELS,
        models: await catalog(env),
      }, corsHeaders(origin, origins));
      return;
    }

    if (request.method === "PUT" && url.pathname === "/api/settings") {
      const body = await readBody(request);
      const parsed = JSON.parse(body) as { provider?: unknown; model?: unknown; thinking?: unknown };
      const provider = String(parsed.provider ?? "").trim();
      const model = String(parsed.model ?? "").trim();
      const thinking = String(parsed.thinking ?? "low").trim();
      const models = await catalog(env);
      const known = models.some((entry) => entry.provider === provider && entry.id === model);
      if (!known) {
        sendJson(response, 400, { error: `${provider}/${model} is not in the provider catalog.` }, corsHeaders(origin, origins));
        return;
      }
      if (!THINKING_LEVELS.includes(thinking as (typeof THINKING_LEVELS)[number])) {
        sendJson(response, 400, { error: `Unknown thinking level "${thinking}".` }, corsHeaders(origin, origins));
        return;
      }
      const saved = await writeDefaultModel({ provider, model, thinking }, env);
      broadcast("settings");
      sendJson(response, 200, { saved, note: "Applies to the next launch." }, corsHeaders(origin, origins));
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
    const bound = typeof address === "object" && address ? address.port : 8790;
    write(`keep-agent dashboard on http://127.0.0.1:${bound}\n`);
  };
  if (dashboard.server.listening) announce();
  else dashboard.server.once("listening", announce);
}

function write(text: string): void {
  process.stderr.write(text);
}
