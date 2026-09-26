/**
 * readonly-mode.ts — Disables file-modifying tools when PI_READONLY=1.
 *
 * Station: before_agent_start → modifies section 2 (tools)
 *
 * USAGE:
 *   Normal: just run "pi" — edit/write work normally (default).
 *   Read-only: PI_READONLY=1 pi          (single session)
 *   Permanent: add PI_READONLY=1 to ~/.pi/agent/.env
 *
 *   The "PI_READONLY=0 pi" force-off is only needed if you set it
 *   permanently in .env but want one normal session without editing .env.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    // Only activate when explicitly turned on
    if (process.env.PI_READONLY !== "1") return;
    if (!event.systemPromptOptions?.selectedTools) return;

    // Remove edit and write — AI can still read, search, and run bash
    event.systemPromptOptions.selectedTools = event.systemPromptOptions.selectedTools.filter(
      (tool) => tool !== "edit" && tool !== "write",
    );

    // Clean up tool snippets too (keeps Available tools section clean)
    if (event.systemPromptOptions.toolSnippets) {
      delete event.systemPromptOptions.toolSnippets["edit"];
      delete event.systemPromptOptions.toolSnippets["write"];
    }
  });
}
