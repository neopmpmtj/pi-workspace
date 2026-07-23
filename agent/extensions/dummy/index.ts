import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  console.log("[AGENT-DUMMY] ~/.pi/extensions/agent-dummy/index.ts — LOADED!");
  console.log("[AGENT-DUMMY] Extension factory executed");

  // ── Startup events ──
  pi.on("project_trust", async (event) => {
    console.log(`[TRACE] project_trust — cwd: ${event.cwd}`);
  });

  pi.on("session_start", async (event) => {
    console.log(`[TRACE] session_start — reason: ${event.reason}`);
  });

  pi.on("resources_discover", async (event) => {
    console.log(`[TRACE] resources_discover — reason: ${event.reason}`);
  });

  // ── Input ──
  pi.on("input", async (event) => {
    console.log(`[TRACE] input — text: "${event.text.slice(0, 60)}..." | source: ${event.source}`);
  });

  // ── Agent lifecycle ──
  pi.on("before_agent_start", async (event) => {
    console.log(`[TRACE] before_agent_start — prompt: "${event.prompt.slice(0, 60)}..."`);
  });

  pi.on("agent_start", async () => {
    console.log("[TRACE] agent_start");
  });

  pi.on("agent_end", async (event) => {
    console.log(`[TRACE] agent_end — messages in run: ${event.messages.length}`);
  });

  pi.on("agent_settled", async () => {
    console.log("[TRACE] agent_settled — agent fully idle");
  });

  // ── Turn lifecycle ──
  pi.on("turn_start", async (event) => {
    console.log(`[TRACE] turn_start — turn #${event.turnIndex}`);
  });

  pi.on("turn_end", async (event) => {
    const toolNames = event.toolResults?.map((r: any) => r.toolName).join(", ") || "none";
    console.log(`[TRACE] turn_end — turn #${event.turnIndex} | tools called: ${toolNames}`);
  });

  // ── Message lifecycle ──
  pi.on("message_start", async (event) => {
    console.log(`[TRACE] message_start — role: ${event.message.role}`);
  });

  pi.on("message_end", async (event) => {
    const contentLen = event.message.content
      ? JSON.stringify(event.message.content).length
      : 0;
    console.log(`[TRACE] message_end — role: ${event.message.role} | content length: ${contentLen}`);
  });

  // ── Tool lifecycle ──
  pi.on("tool_call", async (event) => {
    console.log(`[TRACE] tool_call — tool: ${event.toolName} | callId: ${event.toolCallId.slice(0, 8)}...`);
  });

  pi.on("tool_result", async (event) => {
    console.log(`[TRACE] tool_result — tool: ${event.toolName} | isError: ${event.isError}`);
  });

  pi.on("tool_execution_start", async (event) => {
    console.log(`[TRACE] tool_execution_start — tool: ${event.toolName}`);
  });

  pi.on("tool_execution_end", async (event) => {
    console.log(`[TRACE] tool_execution_end — tool: ${event.toolName} | done`);
  });

  // ── Context ──
  pi.on("context", async (event) => {
    console.log(`[TRACE] context — message count: ${event.messages.length}`);
  });

  console.log("[AGENT-DUMMY] All event handlers registered. Waiting for events...");
}
