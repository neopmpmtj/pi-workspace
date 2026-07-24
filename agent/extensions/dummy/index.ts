import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";

// One log file per session — survives forks, /new, and /resume.
// Format: /tmp/pi-event-trace-YYYY-MM-DDTHH-mm-ss-SSS.log
const SESSION_START = new Date();
const LOG = `/tmp/pi-event-trace-${SESSION_START.toISOString().replace(/:/g, "-").replace(/\..+/, "")}.log`;

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  appendFileSync(LOG, `[${ts}] ${msg}\n`);
}

export default function (pi: ExtensionAPI) {
  log("=== EXTENSION FACTORY EXECUTED ===");
  console.log(`[AGENT-DUMMY] Tracing to: ${LOG}`);

  // ══════════════════════════════════════════════════════════════
  // STARTUP EVENTS
  // ══════════════════════════════════════════════════════════════

  pi.on("project_trust", async (event) => {
    log(`project_trust — cwd: ${event.cwd}`);
  });

  pi.on("session_start", async (event) => {
    log(`session_start — reason: ${event.reason}${event.previousSessionFile ? ` | previousSessionFile: ${event.previousSessionFile}` : ""}`);
  });

  pi.on("resources_discover", async (event) => {
    log(`resources_discover — reason: ${event.reason}`);
  });

  // ══════════════════════════════════════════════════════════════
  // INPUT — hook: can handle, transform, or pass through
  // ══════════════════════════════════════════════════════════════

  pi.on("input", async (event) => {
    log(`input — text: "${event.text.slice(0, 80)}" | source: ${event.source} | streamingBehavior: ${event.streamingBehavior || "idle"}`);
  });

  // ══════════════════════════════════════════════════════════════
  // AGENT LIFECYCLE — before_agent_start is a hook (inject/modify)
  // ══════════════════════════════════════════════════════════════

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

  // ══════════════════════════════════════════════════════════════
  // TURN LIFECYCLE
  // ══════════════════════════════════════════════════════════════

  pi.on("turn_start", async (event) => {
    log(`turn_start — turn #${event.turnIndex}`);
  });

  pi.on("turn_end", async (event) => {
    const toolNames = event.toolResults?.map((r: any) => r.toolName).join(", ") || "none";
    log(`turn_end — turn #${event.turnIndex} | tools: ${toolNames}`);
  });

  // ══════════════════════════════════════════════════════════════
  // MESSAGE LIFECYCLE — message_end is a hook (can replace)
  // ══════════════════════════════════════════════════════════════

  pi.on("message_start", async (event) => {
    log(`message_start — role: ${event.message.role}`);
  });

  pi.on("message_update", async (_event) => {
    // Silenced to avoid log spam during streaming.
    // Uncomment to trace token-by-token deltas:
    // log(`message_update — role: ${event.message.role}`);
  });

  pi.on("message_end", async (event) => {
    const len = event.message.content
      ? JSON.stringify(event.message.content).length
      : 0;
    log(`message_end — role: ${event.message.role} | contentLen: ${len}`);
  });

  // ══════════════════════════════════════════════════════════════
  // TOOL LIFECYCLE — tool_call and tool_result are hooks
  // ══════════════════════════════════════════════════════════════

  pi.on("tool_execution_start", async (event) => {
    log(`tool_execution_start — tool: ${event.toolName}`);
  });

  pi.on("tool_call", async (event) => {
    log(`tool_call — tool: ${event.toolName} | callId: ${event.toolCallId.slice(0, 8)}`);
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

  // ══════════════════════════════════════════════════════════════
  // CONTEXT — hook: can filter/mutate messages before LLM call
  // ══════════════════════════════════════════════════════════════

  pi.on("context", async (event) => {
    log(`context — messages: ${event.messages.length}`);
  });

  // ══════════════════════════════════════════════════════════════
  // PROVIDER HTTP INTERCEPTION — headers hook (mutate), response is read-only
  // ══════════════════════════════════════════════════════════════

  pi.on("before_provider_headers", async (event) => {
    const keys = Object.keys(event.headers).join(", ");
    log(`before_provider_headers — keys: ${keys || "(none)"}`);
  });

  pi.on("after_provider_response", async (event) => {
    log(`after_provider_response — status: ${event.status}`);
  });

  // ══════════════════════════════════════════════════════════════
  // SESSION MANAGEMENT — hooks that can cancel/redirect
  // ══════════════════════════════════════════════════════════════

  pi.on("session_info_changed", async (event) => {
    log(`session_info_changed — name: ${event.name ?? "(cleared)"}`);
  });

  pi.on("session_before_switch", async (event) => {
    log(`session_before_switch — reason: ${event.reason}${event.targetSessionFile ? ` | target: ${event.targetSessionFile}` : ""}`);
  });

  pi.on("session_before_fork", async (event) => {
    log(`session_before_fork — entryId: ${event.entryId.slice(0, 8)} | position: ${event.position}`);
  });

  pi.on("session_before_compact", async (event) => {
    log(`session_before_compact — reason: ${event.reason} | willRetry: ${event.willRetry}`);
  });

  pi.on("session_compact", async (event) => {
    log(`session_compact — reason: ${event.reason} | fromExtension: ${event.fromExtension}`);
  });

  pi.on("session_before_tree", async (event) => {
    log("session_before_tree");
  });

  pi.on("session_tree", async (event) => {
    log(`session_tree — newLeafId: ${event.newLeafId?.slice(0, 8)} | oldLeafId: ${event.oldLeafId?.slice(0, 8)}`);
  });

  pi.on("session_shutdown", async (event) => {
    log(`session_shutdown — reason: ${event.reason}${event.targetSessionFile ? ` | targetSessionFile: ${event.targetSessionFile}` : ""}`);
  });

  // ══════════════════════════════════════════════════════════════
  // MODEL & THINKING — notification only
  // ══════════════════════════════════════════════════════════════

  pi.on("model_select", async (event) => {
    const prev = event.previousModel
      ? `${event.previousModel.provider}/${event.previousModel.id}`
      : "none";
    const next = `${event.model.provider}/${event.model.id}`;
    log(`model_select — source: ${event.source} | ${prev} → ${next}`);
  });

  pi.on("thinking_level_select", async (event) => {
    log(`thinking_level_select — ${event.previousLevel} → ${event.level}`);
  });

  // ══════════════════════════════════════════════════════════════
  // USER BASH — hook: can intercept ! and !! commands
  // ══════════════════════════════════════════════════════════════

  pi.on("user_bash", async (event) => {
    log(`user_bash — command: "${event.command.slice(0, 60)}" | excludeFromContext: ${event.excludeFromContext}`);
  });

  log("=== ALL HANDLERS REGISTERED (28 event types) ===");
}
