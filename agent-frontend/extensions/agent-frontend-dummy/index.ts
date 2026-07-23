import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  console.log("[AGENT-FRONTEND-DUMMY] ~/.pi/agent-frontend/extensions/agent-frontend-dummy/index.ts — LOADED!");

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("[AGENT-FRONTEND-DUMMY] Extension loaded!", "info");
  });

  pi.registerCommand("agent-frontend-dummy", {
    description: "Test the agent-frontend dummy extension",
    handler: async (_args, ctx) => {
      ctx.ui.notify("agent-frontend-dummy extension is working!", "info");
    },
  });
}
