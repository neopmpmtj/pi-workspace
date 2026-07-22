import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  console.log("[dummy] Auto-discovered and loaded!");

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("[dummy] Extension loaded!", "info");
  });

  pi.registerCommand("dummy", {
    description: "Test the dummy extension",
    handler: async (_args, ctx) => {
      ctx.ui.notify("dummy extension is working!", "info");
    },
  });
}
