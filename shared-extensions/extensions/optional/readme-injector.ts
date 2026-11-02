/**
 * readme-injector.ts — Auto-loads project README as context.
 *
 * Station: before_agent_start → modifies section 7 (context files)
 *
 * When README.md exists in the project root, its content (first 2000 chars)
 * is injected into the system prompt so the AI always knows what the project
 * is about — no need to explain it every session.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    if (!event.systemPromptOptions) return;

    const readmePath = join(ctx.cwd, "README.md");
    if (!existsSync(readmePath)) return;

    const content = readFileSync(readmePath, "utf-8").slice(0, 2000);

    if (!event.systemPromptOptions.contextFiles) {
      event.systemPromptOptions.contextFiles = [];
    }

    const alreadyThere = event.systemPromptOptions.contextFiles.some(
      (f) => f.path === readmePath,
    );
    if (!alreadyThere) {
      event.systemPromptOptions.contextFiles.push({
        path: readmePath,
        content: `Project README:\n\n${content}`,
      });
    }
  });
}
