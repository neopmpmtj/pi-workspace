import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Ledger } from "./store.ts";
import type { ToolRates } from "./tool-rates.ts";
import {
  ensureToolTables,
  insertToolCall,
  runAt,
  setToolFileOffset,
  toolFileOffset,
} from "./tool-store.ts";

/**
 * Tool calls the web package made on our behalf. Pi already writes each one into the session
 * file — a `toolResult` message carrying `durationMs`, `queryCount` and `queryProviders` — so
 * this reads sessions rather than instrumenting the package. That means past searches are
 * backfilled, nothing is lost across restarts, and no extension has to hook the tool loop.
 */
const SEARCH_TOOLS = new Set(["web_search", "source_check"]);
const FETCH_TOOLS = new Set(["fetch_content"]);

export interface ToolIngestStats {
  files: number;
  newCalls: number;
  searches: number;
  fetches: number;
}

interface Entry {
  type?: string;
  id?: string;
  timestamp?: string;
  message?: {
    role?: string;
    toolName?: unknown;
    toolCallId?: unknown;
    details?: unknown;
    isError?: unknown;
    durationMs?: unknown;
  };
}

export function syncToolCalls(
  ledger: Ledger,
  options: { sessionsRoot: string; rates: ToolRates },
): ToolIngestStats {
  ensureToolTables(ledger);
  const stats: ToolIngestStats = { files: 0, newCalls: 0, searches: 0, fetches: 0 };

  for (const file of sessionFiles(options.sessionsRoot)) {
    let buffer: Buffer;
    try {
      buffer = readFileSync(file);
    } catch {
      continue;
    }
    const stored = toolFileOffset(ledger.db, file);
    const from = buffer.length < stored ? 0 : stored;
    if (buffer.length === from) continue;

    const text = buffer.subarray(from).toString("utf8");
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline === -1) continue;
    const complete = text.slice(0, lastNewline + 1);

    stats.files += 1;
    ingestChunk(ledger, file, complete, options.rates, stats);
    setToolFileOffset(ledger.db, file, from + Buffer.byteLength(complete, "utf8"));
  }

  return stats;
}

function ingestChunk(
  ledger: Ledger,
  file: string,
  chunk: string,
  rates: ToolRates,
  stats: ToolIngestStats,
): void {
  const entries: Entry[] = [];
  for (const line of chunk.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as Entry);
    } catch {
      // A corrupt line must not stop the rest of the file.
    }
  }
  const sessionId = findSessionId(entries) ?? sessionIdFromFile(file);

  for (const entry of entries) {
    if (entry.type !== "message" || !entry.message) continue;
    const message = entry.message;
    if (message.role !== "toolResult") continue;

    const tool = typeof message.toolName === "string" ? message.toolName : "";
    const kind = SEARCH_TOOLS.has(tool) ? "search" : FETCH_TOOLS.has(tool) ? "fetch" : null;
    if (!kind) continue; // get_search_content and friends cost nothing; not worth a row.

    const details = isRecord(message.details) ? message.details : {};
    const providerCounts = providerCountsOf(details, kind);
    const startedAt = entry.timestamp ?? new Date().toISOString();
    const searches =
      kind === "fetch"
        ? 0
        : Object.values(providerCounts).reduce((sum, count) => sum + count, 0) ||
          numberOr(details.queryCount, 0) ||
          1;
    const urls = kind === "fetch" ? numberOr(details.urlCount, 0) || listLength(details.urls) || 1 : 0;

    const inserted = insertToolCall(ledger, {
      callId: callIdOf(message, entry, startedAt, tool),
      runId: runAt(ledger.db, sessionId, startedAt),
      sessionId,
      sessionFile: file,
      startedAt,
      tool,
      kind,
      searches,
      urls,
      results: numberOr(details.totalResults, 0),
      durationMs: typeof message.durationMs === "number" ? Math.round(message.durationMs) : null,
      providerCounts,
      status: message.isError === true ? "failed" : "ok",
      ratesVersion: rates.version,
    });
    if (!inserted) continue;
    stats.newCalls += 1;
    if (kind === "search") stats.searches += searches;
    else stats.fetches += urls;
  }
}

/**
 * `queryProviders` is `[{ query, providers: ["brave"] }]`. A query answered by two providers
 * was billed twice, so each provider occurrence counts.
 */
function providerCountsOf(details: Record<string, unknown>, kind: "search" | "fetch"): Record<string, number> {
  if (kind === "fetch") return { direct: 1 };
  const counts: Record<string, number> = {};
  const listed = details.queryProviders;
  if (Array.isArray(listed)) {
    for (const item of listed) {
      if (!isRecord(item)) continue;
      const providers = Array.isArray(item.providers) ? item.providers : [];
      for (const provider of providers) {
        if (typeof provider !== "string" || !provider) continue;
        counts[provider] = (counts[provider] ?? 0) + 1;
      }
    }
  }
  if (Object.keys(counts).length === 0) {
    // The provider is unknown, so the price is unknown. Recorded rather than guessed.
    counts.unknown = numberOr(details.queryCount, 1) || 1;
  }
  return counts;
}

function callIdOf(message: NonNullable<Entry["message"]>, entry: Entry, startedAt: string, tool: string): string {
  if (typeof message.toolCallId === "string" && message.toolCallId) return message.toolCallId;
  if (typeof entry.id === "string" && entry.id) return entry.id;
  return `${tool}:${startedAt}`;
}

function findSessionId(entries: Entry[]): string | undefined {
  for (const entry of entries) {
    if (entry.type === "session" && typeof entry.id === "string") return entry.id;
  }
  return undefined;
}

function sessionIdFromFile(file: string): string {
  const base = path.basename(file, ".jsonl");
  const underscore = base.lastIndexOf("_");
  return underscore === -1 ? base : base.slice(underscore + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function listLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function* sessionFiles(root: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) yield* sessionFiles(full);
    else if (entry.endsWith(".jsonl")) yield full;
  }
}
