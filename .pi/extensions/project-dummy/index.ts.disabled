import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  console.log("[PROJECT-DUMMY] ~/.pi/.pi/extensions/project-dummy/index.ts — LOADED!");

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("[PROJECT-DUMMY] Extension loaded!", "info");
  });

  pi.registerCommand("project-dummy", {
    description: "Test the project dummy extension",
    handler: async (_args, ctx) => {
      ctx.ui.notify("project-dummy extension is working!", "info");
    },
  });
}
