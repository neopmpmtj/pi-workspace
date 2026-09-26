/**
 * event-logger.ts — Pipeline Observer
 *
 * Logs the core events in order as they flow through Pi's conveyor belt.
 * Use this to see exactly what happens when you send a message.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const LOG_FILE = join(import.meta.dirname, "..", "events.log");

function log(msg: string) {
  const timestamp = new Date().toISOString();
  appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`);
}

export default function (pi: ExtensionAPI) {
  // ── Conveyor belt: what happens every time you send a message ──

  pi.on("input", async (event, ctx) => {
    log(`▶ INPUT          "${event.text}"`);
    log(`  source: ${event.source}`);
  });

  pi.on("context", async (event, ctx) => {
    log(`▶ CONTEXT        ${event.messages.length} messages to send`);
  });

  pi.on("before_provider_request", async (event, ctx) => {
    const p = event.payload as any;
    log(`▶ BEFORE_REQUEST model=${p.model} max_tokens=${p.max_tokens ?? "default"}`);
  });

  pi.on("before_provider_headers", async (event, ctx) => {
    const keys = Object.keys(event.headers);
    log(`▶ BEFORE_HEADERS ${keys.join(", ")}`);
  });

  pi.on("after_provider_response", async (event, ctx) => {
    log(`▶ AFTER_RESPONSE status=${event.status}`);
  });

  pi.on("message_start", async (event, ctx) => {
    log(`▶ MESSAGE_START  role=${event.message.role}`);
  });

  pi.on("message_end", async (event, ctx) => {
    log(`▶ MESSAGE_END    role=${event.message.role}`);
  });

  // ── Tool calls (when AI wants to do something) ──

  pi.on("tool_call", async (event, ctx) => {
    log(`▶ TOOL_CALL      ${event.toolName}`);
  });

  pi.on("tool_result", async (event, ctx) => {
    log(`▶ TOOL_RESULT    ${event.toolName} error=${event.isError}`);
  });

  // ── Turn boundaries ──

  pi.on("turn_start", async (event, ctx) => {
    log(`▶ TURN_START     #${event.turnIndex}`);
  });

  pi.on("turn_end", async (event, ctx) => {
    log(`▶ TURN_END       #${event.turnIndex}`);
  });
}
