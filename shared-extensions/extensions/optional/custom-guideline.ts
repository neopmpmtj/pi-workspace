/**
 * custom-guideline.ts — Adds a custom guideline to Pi's system prompt.
 *
 * Station: before_agent_start
 *
 * Demonstrates modifying section 4 (Guidelines) via structured options.
 * Much cleaner than string manipulation.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    // Add our custom guideline to the list
    if (event.systemPromptOptions?.promptGuidelines) {
      event.systemPromptOptions.promptGuidelines.push(
        "When answering, add a single-emoji summary at the very end (e.g. 🐛 for bug, 📝 for docs, 🚀 for feature)",
      );
    }
  });
}
