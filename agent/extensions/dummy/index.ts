import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";

const LOG = "/tmp/pi-event-trace.log";

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  appendFileSync(LOG, `[${ts}] ${msg}\n`);
}

export default function (pi: ExtensionAPI) {
  // Clear log on startup
  const { writeFileSync } = require("node:fs");
  writeFileSync(LOG, "");
  log("=== EXTENSION FACTORY EXECUTED ===");

  // ── Startup events ──
  pi.on("project_trust", async (event) => {
    log(`project_trust — cwd: ${event.cwd}`);
  });

  pi.on("session_start", async (event) => {
    log(`session_start — reason: ${event.reason}`);
  });

  pi.on("resources_discover", async (event) => {
    log(`resources_discover — reason: ${event.reason}`);
  });

  // ── Input ──
  pi.on("input", async (event) => {
    log(`input — text: "${event.text.slice(0, 80)}" | source: ${event.source} | streamingBehavior: ${event.streamingBehavior || "idle"}`);
  });

  // ── Agent lifecycle ──
  pi.on("before_agent_start", async (event) => {
    log(`before_agent_start — prompt: "${event.prompt.slice(0, 80)}"`);
  });

  pi.on("agent_start", async () => {
    log("agent_start");
  });

  pi.on("agent_end", async (event) => {
    log(`agent_end — messages in run: ${event.messages.length}`);
  });

  pi.on("agent_settled", async () => {
    log("agent_settled — agent fully idle, no more retries/compaction/follow-up");
  });

  // ── Turn lifecycle ──
  pi.on("turn_start", async (event) => {
    log(`turn_start — turn #${event.turnIndex}`);
  });

  pi.on("turn_end", async (event) => {
    const toolNames = event.toolResults?.map((r: any) => r.toolName).join(", ") || "none";
    log(`turn_end — turn #${event.turnIndex} | tools: ${toolNames}`);
  });

  // ── Message lifecycle ──
  pi.on("message_start", async (event) => {
    log(`message_start — role: ${event.message.role}`);
  });

  pi.on("message_update", async (event) => {
    // Only log first update per message to avoid spam
  });

  pi.on("message_end", async (event) => {
    const len = event.message.content
      ? JSON.stringify(event.message.content).length
      : 0;
    log(`message_end — role: ${event.message.role} | contentLen: ${len}`);
  });

  // ── Tool lifecycle ──
  pi.on("tool_call", async (event) => {
    log(`tool_call — tool: ${event.toolName} | callId: ${event.toolCallId.slice(0, 8)}`);
  });

  pi.on("tool_execution_start", async (event) => {
    log(`tool_execution_start — tool: ${event.toolName}`);
  });

  pi.on("tool_execution_update", async (event) => {
    log(`tool_execution_update — tool: ${event.toolName}`);
  });

  pi.on("tool_execution_end", async (event) => {
    log(`tool_execution_end — tool: ${event.toolName} | isError: ${event.isError}`);
  });

  pi.on("tool_result", async (event) => {
    log(`tool_result — tool: ${event.toolName} | isError: ${event.isError}`);
  });

  // ── Context ──
  pi.on("context", async (event) => {
    log(`context — messages: ${event.messages.length}`);
  });

  // ── Session lifecycle ──
  pi.on("session_shutdown", async (event) => {
    log(`session_shutdown — reason: ${event.reason}`);
  });

  log("=== ALL HANDLERS REGISTERED ===");
}
