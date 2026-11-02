import { existsSync, readFileSync, readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chatKey, imageKey, sessionChatPoints, type ChatPoint, type ImagePoint } from "./parse.ts";
import { builtInRates, type RatesSnapshot } from "./src/rates.ts";
import { MODEL_RATES_FILE, readModelRates } from "../src/model-rates.ts";
import { modeSwitches, readDefaultMode, writeDefaultMode } from "../src/default-mode.ts";
import { DEFAULT_LANGUAGE, readDefaultLanguage, writeDefaultLanguage } from "../src/default-language.ts";
import { implicitDefaultProvider, readDefaultProvider, writeDefaultSelection } from "../src/default-provider.ts";
import { readCountEffort, writeCountEffort } from "../src/count-effort.ts";
import { readDetailedEffort, writeDetailedEffort } from "../src/detailed-effort.ts";
import { agentDir as resolveAgentDir } from "../src/env.ts";
import { readImagesDir, writeImagesDir } from "../src/images-dir.ts";
import { PRESET_EFFORT_UI_DEFAULT, readPresetEffort, writePresetEffort } from "../src/preset-effort.ts";
import { BUILT_IN_PROMPTS, LANGUAGE_PLACEHOLDER, OUTPUT_SHAPE, PROMPT_MODES, PROMPT_RULES, type PromptOverrides } from "../src/prompt.ts";
import { clearPromptOverride, MAX_PROMPT_LENGTH, readPromptOverrides, writePromptOverride } from "../src/prompt-overrides.ts";
import {
  DEFAULT_METRICS_FILE,
  insertChatCalls,
  readChatCalls,
  readImageCalls,
  withMetrics,
  type ChatCall,
  type ImageCall,
} from "../src/metrics.ts";

const DEFAULT_ORIGINS = "http://127.0.0.1:5173,http://localhost:5173";

export function startDashboard(options: {
  root?: string;
  host?: string;
  port?: number;
  agentDir?: string;
  origins?: string[];
} = {}): {
  server: Server;
  close: () => Promise<void>;
} {
  const root = path.resolve(options.root ?? process.env.DASHBOARD_ROOT ?? path.join(import.meta.dirname, ".."));
  const metricsPath = path.join(root, DEFAULT_METRICS_FILE);
  const sessionsDir = path.join(root, "sessions");
  const host = options.host ?? process.env.DASHBOARD_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.DASHBOARD_PORT ?? 8788);
  const origins = options.origins ?? (process.env.DASHBOARD_ORIGIN ?? DEFAULT_ORIGINS)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const anyOrigin = origins.includes("*");
  const agentDirectory = options.agentDir ?? process.env.PI_CODING_AGENT_DIR ?? root;
  const modeEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDirectory,
  };
  const clients = new Set<ServerResponse>();
  const seenImages = new Set<string>();
  const seenChats = new Set<string>();
  const sessionMarks = new Map<string, number>();

  const load = (): { images: ImagePoint[]; chats: ChatPoint[] } => {
    ingestSessions();
    return withMetrics(metricsPath, (db) => ({
      images: readImageCalls(db).map(imagePoint),
      chats: readChatCalls(db).map(chatPoint),
    }));
  };

  const ingestSessions = (): void => {
    const pending = sessionFiles(sessionsDir).filter((file) => {
      const mark = statSync(file).mtimeMs;
      return sessionMarks.get(file) !== mark;
    });
    if (pending.length === 0 && existsSync(metricsPath)) return;
    withMetrics(metricsPath, (db) => {
      for (const file of pending) {
        try {
          insertChatCalls(db, sessionChatPoints(readFileSync(file, "utf8")));
          sessionMarks.set(file, statSync(file).mtimeMs);
        } catch {
          // A read racing an append keeps the rows already stored.
        }
      }
    });
  };

  const emit = (event: string, data: ImagePoint | ChatPoint): void => {
    for (const client of clients) writeEvent(client, event, data);
  };

  const publish = (): void => {
    const { images, chats } = load();
    for (const point of images) {
      const key = imageKey(point);
      if (seenImages.has(key)) continue;
      seenImages.add(key);
      emit("image", point);
    }
    for (const point of chats) {
      const key = chatKey(point);
      if (seenChats.has(key)) continue;
      seenChats.add(key);
      emit("chat", point);
    }
  };

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      if (res.headersSent) return;
      const message = error instanceof Error ? error.message : "Dashboard request failed.";
      sendError(res, 500, message);
    });
  });

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    const requestOrigin = req.headers.origin;
    const allowed = requestOrigin === undefined || anyOrigin || origins.includes(requestOrigin);
    res.setHeader("vary", "origin");
    if (requestOrigin !== undefined && allowed) {
      res.setHeader("access-control-allow-origin", anyOrigin ? "*" : requestOrigin);
    }
    res.setHeader("access-control-allow-methods", "GET, PUT, DELETE, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    if (!allowed && req.method !== "GET") {
      sendError(res, 403, `Origin ${requestOrigin} is not allowed. Add it to DASHBOARD_ORIGIN.`);
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "PUT" && url.pathname === "/api/default-mode") {
      await saveDefaultMode(req, res, modeEnv);
      return;
    }
    if (req.method === "PUT" && url.pathname === "/api/detailed-effort") {
      await saveDetailedEffort(req, res, modeEnv);
      return;
    }
    if (req.method === "PUT" && url.pathname === "/api/count-effort") {
      await saveCountEffort(req, res, modeEnv);
      return;
    }
    if (req.method === "PUT" && url.pathname === "/api/preset-effort") {
      await savePresetEffort(req, res, modeEnv);
      return;
    }
    if (req.method === "PUT" && url.pathname === "/api/default-provider") {
      await saveDefaultProvider(req, res, modeEnv);
      return;
    }
    if (req.method === "PUT" && url.pathname === "/api/default-language") {
      await saveDefaultLanguage(req, res, modeEnv);
      return;
    }
    if (req.method === "PUT" && url.pathname === "/api/images-dir") {
      await saveImagesDir(req, res, modeEnv);
      return;
    }
    const promptMode = url.pathname.startsWith("/api/prompts/")
      ? decodeURIComponent(url.pathname.slice("/api/prompts/".length))
      : undefined;
    if (promptMode !== undefined && req.method === "PUT") {
      await savePrompt(req, res, modeEnv, promptMode);
      return;
    }
    if (promptMode !== undefined && req.method === "DELETE") {
      await resetPrompt(res, modeEnv, promptMode);
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return;
    }
    if (url.pathname === "/api/default-mode") {
      sendJson(res, { switches: modeSwitches(await readDefaultMode(modeEnv)) });
      return;
    }
    if (url.pathname === "/api/detailed-effort") {
      sendJson(res, { effort: await readDetailedEffort(modeEnv) });
      return;
    }
    if (url.pathname === "/api/count-effort") {
      sendJson(res, { effort: await readCountEffort(modeEnv) });
      return;
    }
    if (url.pathname === "/api/preset-effort") {
      sendJson(res, { effort: (await readPresetEffort(modeEnv)) ?? PRESET_EFFORT_UI_DEFAULT });
      return;
    }
    if (url.pathname === "/api/default-provider") {
      sendJson(res, (await readDefaultProvider(modeEnv)) ?? implicitDefaultProvider());
      return;
    }
    if (url.pathname === "/api/default-language") {
      sendJson(res, { language: (await readDefaultLanguage(modeEnv)) ?? DEFAULT_LANGUAGE });
      return;
    }
    if (url.pathname === "/api/images-dir") {
      sendJson(res, { dir: (await readImagesDir(modeEnv)) ?? null });
      return;
    }
    if (url.pathname === "/api/prompts") {
      sendJson(res, promptsBody(await readPromptOverrides(modeEnv)));
      return;
    }
    if (url.pathname === "/api/images") {
      sendJson(res, { points: load().images });
      return;
    }
    if (url.pathname === "/api/chat") {
      sendJson(res, { points: load().chats });
      return;
    }
    if (url.pathname === "/api/rates") {
      sendJson(res, await ratesSnapshot(modeEnv));
      return;
    }
    if (url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      clients.add(res);
      const { images, chats } = load();
      for (const point of images) {
        seenImages.add(imageKey(point));
        writeEvent(res, "image", point);
      }
      for (const point of chats) {
        seenChats.add(chatKey(point));
        writeEvent(res, "chat", point);
      }
      const ping = setInterval(() => {
        res.write(": ping\n\n");
      }, 20000);
      res.on("close", () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }
    res.writeHead(404, { "cache-control": "no-store" });
    res.end();
  };

  publish();
  const watchers = [watchTree(path.join(root, "logs"), publish), watchTree(sessionsDir, publish)].filter(
    (watcher): watcher is FSWatcher => watcher !== undefined,
  );
  const timer = setInterval(publish, 5000);
  server.listen(port, host, () => {
    const address = server.address();
    const bound = typeof address === "object" && address ? address.port : port;
    console.log(`Dashboard API listening on http://${host}:${bound}`);
  });

  return {
    server,
    close: () => new Promise((resolve) => {
      clearInterval(timer);
      for (const watcher of watchers) watcher.close();
      server.close(() => resolve());
    }),
  };
}

function writeEvent(res: ServerResponse, event: string, data: ImagePoint | ChatPoint): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Re-read on every request so a file the external service replaced is used without a restart. */
async function ratesSnapshot(env: NodeJS.ProcessEnv): Promise<RatesSnapshot> {
  try {
    const file = await readModelRates(env);
    if (file) return { source: "file", updatedAt: file.updatedAt, models: { ...builtInRates, ...file.models } };
    return { source: "built-in", updatedAt: null, models: builtInRates };
  } catch (error) {
    const message = error instanceof Error ? error.message : `Could not read ${MODEL_RATES_FILE}.`;
    console.error(`[FAIL] ${message} Using built-in rates.`);
    return { source: "built-in", updatedAt: null, models: builtInRates, error: message };
  }
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify({ error: message }));
}

async function saveDetailedEffort(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv): Promise<void> {
  const effort = await bodyString(req, res, "effort");
  if (effort === undefined) return;
  try {
    sendJson(res, { effort: await writeDetailedEffort(env, effort) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the detailed effort.";
    sendError(res, 400, message);
  }
}

async function saveCountEffort(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv): Promise<void> {
  const effort = await bodyString(req, res, "effort");
  if (effort === undefined) return;
  try {
    sendJson(res, { effort: await writeCountEffort(env, effort) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the count effort.";
    sendError(res, 400, message);
  }
}

async function savePresetEffort(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv): Promise<void> {
  const effort = await bodyString(req, res, "effort");
  if (effort === undefined) return;
  try {
    sendJson(res, { effort: await writePresetEffort(env, effort) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the preset effort.";
    sendError(res, 400, message);
  }
}

async function saveDefaultProvider(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv): Promise<void> {
  const body = await readObject(req, res);
  if (!body) return;
  const provider = body.provider;
  const model = body.model;
  if (provider !== undefined && typeof provider !== "string") {
    sendError(res, 400, "Request body provider must be a string.");
    return;
  }
  if (model !== undefined && typeof model !== "string") {
    sendError(res, 400, "Request body model must be a string.");
    return;
  }
  if (typeof provider !== "string" && typeof model !== "string") {
    sendError(res, 400, "Request body must include a provider or model string.");
    return;
  }
  try {
    sendJson(res, await writeDefaultSelection(env, {
      ...(typeof provider === "string" ? { provider } : {}),
      ...(typeof model === "string" ? { model } : {}),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the default model.";
    sendError(res, 400, message);
  }
}

async function saveDefaultLanguage(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv): Promise<void> {
  const language = await bodyString(req, res, "language");
  if (language === undefined) return;
  try {
    sendJson(res, { language: await writeDefaultLanguage(env, language) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the default language.";
    sendError(res, 400, message);
  }
}

async function saveImagesDir(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv): Promise<void> {
  const dir = await bodyString(req, res, "dir");
  if (dir === undefined) return;
  try {
    sendJson(res, { dir: await writeImagesDir(env, dir, resolveAgentDir(env)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the images directory.";
    sendError(res, 400, message);
  }
}

async function saveDefaultMode(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv): Promise<void> {
  const mode = await bodyString(req, res, "mode");
  if (mode === undefined) return;
  try {
    const active = await writeDefaultMode(env, mode);
    sendJson(res, { switches: modeSwitches(active) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the default mode.";
    sendError(res, 400, message);
  }
}

function promptsBody(overrides: PromptOverrides) {
  return {
    shape: OUTPUT_SHAPE,
    rules: PROMPT_RULES,
    placeholder: LANGUAGE_PLACEHOLDER,
    maxLength: MAX_PROMPT_LENGTH,
    prompts: PROMPT_MODES.map((mode) => ({ mode, builtIn: BUILT_IN_PROMPTS[mode], saved: overrides[mode] ?? null })),
  };
}

async function savePrompt(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv, mode: string): Promise<void> {
  const prompt = await bodyString(req, res, "prompt");
  if (prompt === undefined) return;
  try {
    sendJson(res, promptsBody(await writePromptOverride(env, mode, prompt)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the prompt.";
    sendError(res, 400, message);
  }
}

async function resetPrompt(res: ServerResponse, env: NodeJS.ProcessEnv, mode: string): Promise<void> {
  try {
    sendJson(res, promptsBody(await clearPromptOverride(env, mode)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reset the prompt.";
    sendError(res, 400, message);
  }
}

async function readObject(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req)) as unknown;
  } catch {
    sendError(res, 400, "Request body must be JSON.");
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    sendError(res, 400, "Request body must be a JSON object.");
    return undefined;
  }
  return parsed as Record<string, unknown>;
}

async function bodyString(req: IncomingMessage, res: ServerResponse, field: string): Promise<string | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req)) as unknown;
  } catch {
    sendError(res, 400, "Request body must be JSON.");
    return undefined;
  }
  const value = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)[field]
    : undefined;
  if (typeof value !== "string") {
    sendError(res, 400, `Request body must include a ${field} string.`);
    return undefined;
  }
  return value;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sessionFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(full);
    }
  }
  found.sort();
  return found;
}

function watchTree(dir: string, onChange: () => void): FSWatcher | undefined {
  if (!existsSync(dir)) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(dir, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 200);
  });
  watcher.on("error", () => {});
  return watcher;
}

function imagePoint(row: ImageCall): ImagePoint {
  return {
    runId: row.runId,
    recordedAt: row.recordedAt,
    filename: row.filename,
    mode: row.mode,
    effort: row.effort,
    language: row.language,
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    model: row.model,
    provider: row.provider,
    status: row.status,
    apiDurationSeconds: row.apiDurationSeconds,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    reasoningTokens: row.reasoningTokens,
    cachedTokens: row.cachedTokens,
  };
}

function chatPoint(row: ChatCall): ChatPoint {
  return {
    id: row.id,
    recordedAt: row.recordedAt,
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    model: row.model,
    provider: row.provider,
    costTotal: row.costTotal,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    reasoningTokens: row.reasoningTokens,
  };
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invoked === import.meta.url) startDashboard();
