/**
 * session-memory.ts — Phase 1: Data Gathering Pipeline
 *
 * Captures raw session data whenever we leave via /new, /fork, or quit.
 * Uses the session ID (from the sessionFile path) as the filename — same
 * session always writes to the same file, so quit/resume doesn't duplicate.
 *
 * Phase 2 (LLM summarization) is handled by the standalone summarizer:
 *   session-summarizer/summarize.mjs
 *
 * NOTE: This is the data capture layer only — no AI calls here.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

/**
 * Where to save session snapshots.
 * Set PI_SESSION_SUMMARIES_PATH to override (e.g. for sharing with other instances).
 * Falls back to <project>/.pi/../session-summaries relative to this extension.
 */
const SUMMARIES_DIR = process.env.PI_SESSION_SUMMARIES_PATH
  || join(import.meta.dirname, "..", "..", "session-summaries");

function ensureDir() {
  if (!existsSync(SUMMARIES_DIR)) {
    mkdirSync(SUMMARIES_DIR, { recursive: true });
  }
}

function captureSession(manager: any, reason: string) {
  ensureDir();

  const messages: Array<{ role: string; content: string }> =
    (manager.buildSessionContext().messages ?? []).map((m: any) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));

  const sessionFile = manager.getSessionFile() ?? "unknown";
  const sessionName = manager.getSessionName() ?? "unnamed";
  const now = new Date();

  // Use the session's creation timestamp + ID as a stable filename.
  // Same session always maps to the same file — no duplicates on quit/resume.
  // Example sessionFile: .../2026-07-29T15-36-34-994Z_019fae85-3bb2-....jsonl
  // Extracts:            2026-07-29T15-36-34-994Z_019fae85-3bb2-...
  const sessionId = sessionFile !== "unknown"
    ? basename(sessionFile, ".jsonl")
    : `unknown_${now.toISOString().replace(/T/, "_").replace(/\..+/, "").replace(/:/g, "-")}`;

  const filepath = join(SUMMARIES_DIR, `${sessionId}_${reason}.json`);

  const data = {
    sessionName,
    sessionFile,
    reason,
    // Include the capture timestamp so we can see when this snapshot was taken
    capturedAt: now.toISOString(),
    messageCount: messages.length,
    summary: null,
    messages,
  };

  writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
}

export default function (pi: ExtensionAPI) {
  pi.on("session_before_switch", async (event, ctx) => {
    if (event.reason === "new") {
      captureSession(ctx.sessionManager, "new");
    }
  });

  pi.on("session_before_fork", async (event, ctx) => {
    captureSession(ctx.sessionManager, "fork");
  });

  pi.on("session_shutdown", async (event, ctx) => {
    if (event.reason === "quit") {
      captureSession(ctx.sessionManager, "quit");
    }
  });
}
