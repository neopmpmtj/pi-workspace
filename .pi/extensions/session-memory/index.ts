/**
 * session-memory/index.ts — Phase 1: Data Gathering Pipeline
 *
 * Captures raw session data whenever we leave via /new, /fork, or quit.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUMMARIES_DIR = process.env.PI_SESSION_SUMMARIES_PATH
  || join(__dirname, "..", "..", "..", "sessions-summaries");

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

  const sessionId = sessionFile !== "unknown"
    ? basename(sessionFile, ".jsonl")
    : `unknown_${now.toISOString().replace(/T/, "_").replace(/\..+/, "").replace(/:/g, "-")}`;

  const filepath = join(SUMMARIES_DIR, `${sessionId}_${reason}.json`);

  const data = {
    sessionName,
    sessionFile,
    reason,
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
