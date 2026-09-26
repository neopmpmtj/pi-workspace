/**
 * save-memory-command.ts — /save-memory slash command
 *
 * Captures the current session and creates an AI summary.
 * Uses ctx.waitForIdle() (command-only) to wait for the agent to finish.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("save-memory", {
    description: "Save a summary of the current session to sessions-memory/",

    handler: async (_args: string, ctx) => {
      // Wait for the agent to finish before we read the session
      await ctx.waitForIdle();

      const sessionFile = ctx.sessionManager.getSessionFile?.();
      if (!sessionFile) {
        ctx.ui.notify("No session file found — cannot summarize.", "warning");
        return;
      }

      const summarizerPath = join(
        import.meta.dirname,
        "..",
        "..",
        "session-summarizer",
        "summarize.mjs",
      );

      try {
        ctx.ui.notify("Generating summary...", "info");

        const output = execFileSync("node", [summarizerPath, sessionFile], {
          encoding: "utf-8",
          timeout: 30000, // 30 second timeout
        });

        // Pick out the "Saved summary" line
        const savedLine = output
          .split("\n")
          .find((line) => line.includes("Saved summary"));
        const result = savedLine || "Summary saved.";

        ctx.ui.notify(result.trim(), "info");
      } catch (err: any) {
        ctx.ui.notify(
          `Summary failed: ${err.message || "unknown error"}`,
          "error",
        );
      }
    },
  });
}
