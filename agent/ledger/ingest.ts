import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import { labelOf } from "./labels.ts";
import { tokensOf } from "./tokens.ts";
import {
  fileOffset,
  lastTurnId,
  mergeRun,
  setFileOffset,
  type Ledger,
} from "./store.ts";

export interface IngestStats {
  /** Session files whose new bytes were read. */
  files: number;
  newCalls: number;
  newTurns: number;
  /** Command runs folded into the session turn that launched them. */
  merged: number;
}

interface Entry {
  type?: string;
  id?: string;
  parentId?: string;
  timestamp?: string;
  details?: { runId?: unknown };
  message?: {
    role?: string;
    content?: unknown;
    usage?: Usage;
    provider?: unknown;
    model?: unknown;
    responseModel?: unknown;
    thinkingLevel?: unknown;
    providerThinkingLevel?: unknown;
    durationMs?: unknown;
    stopReason?: unknown;
    timestamp?: unknown;
  };
}

/**
 * Reads every session file from the bytes not yet seen. Pi's session log is the
 * record of every chat turn, so this is where channel 2 enters the ledger; the
 * extension only ever writes channel 1.
 */
export function syncSessions(
  ledger: Ledger,
  options: { sessionsRoot: string; ratesVersion: string },
): IngestStats {
  const stats: IngestStats = { files: 0, newCalls: 0, newTurns: 0, merged: 0 };
  for (const file of sessionFiles(options.sessionsRoot)) {
    let buffer: Buffer;
    try {
      buffer = readFileSync(file);
    } catch {
      continue;
    }
    const stored = fileOffset(ledger.db, file);
    // A shorter file means it was replaced or truncated; start over. Repeated
    // call ids keep that safe.
    const from = buffer.length < stored ? 0 : stored;
    if (buffer.length === from) continue;

    const text = buffer.subarray(from).toString("utf8");
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline === -1) continue; // a half-written line waits for the next read
    const complete = text.slice(0, lastNewline + 1);

    stats.files += 1;
    ingestChunk(ledger, file, complete, options.ratesVersion, stats);
    setFileOffset(ledger.db, file, from + Buffer.byteLength(complete, "utf8"));
  }
  return stats;
}

function ingestChunk(
  ledger: Ledger,
  file: string,
  chunk: string,
  ratesVersion: string,
  stats: IngestStats,
): void {
  const entries = parseLines(chunk);
  const sessionId = findSessionId(entries) ?? sessionIdFromFile(file);
  let currentTurn = lastTurnId(ledger.db, sessionId);
  const links: Array<{ runId: string; parentId?: string }> = [];

  for (const entry of entries) {
    if (entry.type === "message" && entry.message) {
      if (entry.message.role === "user") {
        const text = userText(entry.message.content);
        const runId = entry.id ?? `${sessionId}/turn`;
        const startedAt = entry.timestamp ?? new Date().toISOString();
        ledger.upsertRun({
          runId,
          sessionId,
          sessionFile: file,
          turnId: runId,
          startedAt,
          label: labelOf(text),
          origin: text.trimStart().startsWith("/ask") ? "command" : "chat",
          provider: null,
          model: null,
        });
        currentTurn = runId;
        stats.newTurns += 1;
      } else if (entry.message.role === "assistant") {
        const message = entry.message;
        const usage = message.usage;
        if (!usage) continue;
        if (!currentTurn) {
          const runId = `${sessionId}/session`;
          ledger.upsertRun({
            runId,
            sessionId,
            sessionFile: file,
            turnId: null,
            startedAt: entry.timestamp ?? new Date().toISOString(),
            label: "(session)",
            origin: "chat",
            provider: null,
            model: null,
          });
          currentTurn = runId;
        }
        const tokens = tokensOf(usage);
        const inserted = ledger.insertCall({
          callId: `${sessionId}/${entry.id ?? randomSuffix(message.timestamp)}`,
          runId: currentTurn,
          origin: "chat",
          source: "session",
          sessionId,
          sessionFile: file,
          startedAt: entry.timestamp ?? new Date().toISOString(),
          durationMs: typeof message.durationMs === "number" ? Math.round(message.durationMs) : null,
          provider: typeof message.provider === "string" ? message.provider : "",
          modelRequested: typeof message.model === "string" ? message.model : "",
          modelReturned: typeof message.responseModel === "string" ? message.responseModel : null,
          effortRequested: null,
          effortEffective: effortOf(message),
          input: tokens?.input ?? 0,
          output: tokens?.output ?? 0,
          cacheRead: tokens?.cacheRead ?? 0,
          cacheWrite: tokens?.cacheWrite ?? 0,
          reasoning: tokens?.reasoning ?? null,
          totalTokens: tokens?.total ?? 0,
          costPi: typeof usage.cost?.total === "number" ? usage.cost.total : null,
          ratesVersion,
          status: message.stopReason === "error" ? "failed" : "ok",
          failureKind: message.stopReason === "error" ? "provider_error" : null,
        });
        if (inserted) stats.newCalls += 1;
      }
    } else if (entry.type === "custom_message" && typeof entry.details?.runId === "string") {
      links.push({ runId: entry.details.runId, ...(entry.parentId ? { parentId: entry.parentId } : {}) });
    }
  }

  for (const link of links) {
    // The command wrote its own run before the session existed. When the command
    // was the session's opening message, Pi recorded it as a user entry and the
    // two rows are one run.
    const parent = link.parentId ? parentTurn(ledger, link.parentId) : undefined;
    if (parent && parent.label.trimStart().startsWith("/ask")) {
      if (mergeRun(ledger.db, link.runId, parent.runId)) stats.merged += 1;
      attachSession(ledger, parent.runId, sessionId, file);
    } else {
      attachSession(ledger, link.runId, sessionId, file);
    }
  }
}

function attachSession(ledger: Ledger, runId: string, sessionId: string, file: string): void {
  ledger.db
    .prepare(
      "UPDATE calls SET session_id = COALESCE(session_id, ?), session_file = COALESCE(session_file, ?) WHERE run_id = ?",
    )
    .run(sessionId, file, runId);
  ledger.db
    .prepare("UPDATE runs SET session_id = COALESCE(session_id, ?), session_file = COALESCE(session_file, ?) WHERE run_id = ?")
    .run(sessionId, file, runId);
}

function parentTurn(ledger: Ledger, runId: string): { runId: string; label: string } | undefined {
  const row = ledger.db.prepare("SELECT run_id, label FROM runs WHERE run_id = ?").get(runId) as
    | { run_id: string; label: string }
    | undefined;
  return row ? { runId: row.run_id, label: String(row.label) } : undefined;
}

function parseLines(chunk: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of chunk.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as Entry);
    } catch {
      // A corrupt line must not stop the rest of the session from being read.
    }
  }
  return entries;
}

function findSessionId(entries: Entry[]): string | undefined {
  for (const entry of entries) {
    if (entry.type === "session" && typeof entry.id === "string") return entry.id;
  }
  return undefined;
}

/** `…/<timestamp>_<uuid>.jsonl` */
function sessionIdFromFile(file: string): string {
  const base = path.basename(file, ".jsonl");
  const underscore = base.lastIndexOf("_");
  return underscore === -1 ? base : base.slice(underscore + 1);
}

export function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? String((part as { text: string }).text) : ""))
      .join("")
      .trim();
  }
  return "";
}

function effortOf(message: NonNullable<Entry["message"]>): string | null {
  if (typeof message.thinkingLevel === "string") return message.thinkingLevel;
  if (typeof message.providerThinkingLevel === "string") return message.providerThinkingLevel;
  return null;
}

function randomSuffix(value: unknown): string {
  return `${String(value ?? "")}-${Math.random().toString(16).slice(2, 10)}`;
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
