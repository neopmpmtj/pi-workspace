// Project dashboard. Localhost only. It starts agent dashboards and edits the
// control-plane JSON files. It is not itself one of those agents.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_PORT } from "./agents.ts";
import { listRuns, openAgent, startAgent, startAll, stopAgent, stopAll } from "./processes.ts";
import { readControlPlane, SettingsError, writeAgentSettings, writeGate, writeInputPhrase, writePromptBuild, type ControlPlane } from "./store.ts";

const PUBLIC_DIR = path.join(import.meta.dirname, "public");
const MAX_BODY = 256_000;
const HOST = "127.0.0.1";

const FILES: Record<string, string> = {
  "/": "index.html",
  "/settings": "settings.html",
  "/style.css": "style.css",
  "/app.js": "app.js",
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = createServer((request, response) => {
  void route(request, response).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Request failed.";
    const status = error instanceof SettingsError ? 400 : 500;
    sendJson(response, status, { error: message });
  });
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${HOST}`);
  const method = request.method ?? "GET";
  if (method === "GET" && FILES[url.pathname]) {
    await sendFile(response, FILES[url.pathname]);
    return;
  }
  if (method === "GET" && url.pathname === "/api/agents") {
    sendJson(response, 200, { agents: await listRuns() });
    return;
  }
  if (method === "POST" && url.pathname === "/api/agents/start-all") {
    sendJson(response, 200, await startAll());
    return;
  }
  if (method === "POST" && url.pathname === "/api/agents/stop-all") {
    sendJson(response, 200, { agents: await stopAll() });
    return;
  }
  const agentAction = url.pathname.match(/^\/api\/agents\/([a-z-]+)\/(start|stop|open)$/);
  if (method === "POST" && agentAction) {
    const [, id, action] = agentAction;
    const run = action === "start" ? await startAgent(id) : action === "stop" ? await stopAgent(id) : await openAgent(id);
    sendJson(response, 200, { agent: run });
    return;
  }
  if (method === "GET" && url.pathname === "/api/settings") {
    const plane = await readControlPlane();
    logNotes(plane);
    sendJson(response, 200, plane);
    return;
  }
  const gate = url.pathname.match(/^\/api\/settings\/gates\/([A-Za-z0-9]+)$/);
  if (method === "PUT" && gate) {
    sendJson(response, 200, { gate: await writeGate(gate[1], await readJson(request)) });
    return;
  }
  if (method === "PUT" && url.pathname === "/api/settings/input-phrase") {
    sendJson(response, 200, { inputPhrase: await writeInputPhrase(await readJson(request)) });
    return;
  }
  if (method === "PUT" && url.pathname === "/api/settings/prompt-build") {
    sendJson(response, 200, { promptBuild: await writePromptBuild(await readJson(request)) });
    return;
  }
  const agentSettings = url.pathname.match(/^\/api\/settings\/agents\/([a-z-]+)$/);
  if (method === "PUT" && agentSettings) {
    sendJson(response, 200, { agent: await writeAgentSettings(agentSettings[1], await readJson(request)) });
    return;
  }
  sendJson(response, 404, { error: "Not found." });
}

/** Reports skipped files in the server log, once per change of state (the page is polled). */
let lastNotes = "";

function logNotes(plane: ControlPlane): void {
  const notes = [
    ...plane.seeded.map((message) => `[note] ${message}`),
    ...plane.problems.map((problem) => `[note] ${problem.file}: ${problem.message}`),
  ];
  const joined = notes.join("\n");
  if (joined === lastNotes) return;
  lastNotes = joined;
  for (const line of notes) console.error(line);
}

async function sendFile(response: ServerResponse, name: string): Promise<void> {
  const file = path.join(PUBLIC_DIR, name);
  const body = await readFile(file);
  const type = TYPES[path.extname(name)] ?? "application/octet-stream";
  response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY) throw new SettingsError("Request body is too large.");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SettingsError("Request body is not valid JSON.");
  }
}

server.listen(PROJECT_PORT, HOST, () => {
  process.stderr.write(`project dashboard on http://${HOST}:${PROJECT_PORT}\n`);
});
