/**
 * error-logger.ts — Crash & Error History Tracker
 *
 * Catches uncaught exceptions and unhandled rejections and logs
 * them to .pi/observability/errors.jsonl for later querying.
 *
 * Copy this single file to any Pi instance to get persistent error history.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Where to save ───────────────────────────────────────────────────────────

const OBS_DIR = join(import.meta.dirname, "..", "observability");
const ERRORS_FILE = join(OBS_DIR, "errors.jsonl");

function ensureDir() {
  mkdirSync(OBS_DIR, { recursive: true });
}

// ── Record an error ─────────────────────────────────────────────────────────

function recordError(type: "uncaughtException" | "unhandledRejection", error: unknown) {
  ensureDir();
  const err = error instanceof Error ? error : new Error(String(error));
  const stack = err.stack?.split("\n").map((s) => s.trim()) ?? [];

  let piVersion: string | undefined;
  try {
    const pkgDir = join(process.execPath, "..", "..", "lib", "node_modules");
    piVersion = JSON.parse(
      readFileSync(join(pkgDir, "@earendil-works/pi-coding-agent/package.json"), "utf-8")
    ).version;
  } catch {}

  appendFileSync(ERRORS_FILE, JSON.stringify({
    timestamp: new Date().toISOString(),
    type,
    message: err.message,
    stack,
    piVersion,
    nodeVersion: process.version,
  }) + "\n");
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Confirm we're alive
  ensureDir();
  appendFileSync(ERRORS_FILE, JSON.stringify({
    timestamp: new Date().toISOString(),
    type: "init",
    message: "Crash traps registered",
  }) + "\n");

  // Tell the user
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("🛡 Error logger active", "info");
  });

  // ── The traps ─────────────────────────────────────────────────────────

  process.on("uncaughtException", (error) => {
    recordError("uncaughtException", error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    recordError("unhandledRejection", reason);
  });
}
