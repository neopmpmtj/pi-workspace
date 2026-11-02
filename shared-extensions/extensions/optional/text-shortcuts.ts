/**
 * text-shortcuts.ts — Auto-expand ::shortcuts at the input station.
 *
 * Station: input (first stop on the conveyor belt)
 *
 * Type "::fix"  → Pi sees "investigate and fix the issue"
 * Type "::todo" → Pi sees "create a checklist..."
 *
 * You can still use @file after the shortcut:
 *   ::fix @session-memory.ts  works fine
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const LOG_FILE = join(import.meta.dirname, "..", "events.log");

function log(msg: string) {
  const ts = new Date().toISOString();
  appendFileSync(LOG_FILE, `[${ts}] SHORTCUT ${msg}\n`);
}

const SHORTCUTS: Record<string, string> = {
  "::fix": "Investigate and fix the issue. Be thorough — understand the root cause before making changes. Edit the relevant files directly.",
  "::todo": "Review the conversation and create a checklist of what still needs to be done. Be specific about each item.",
  "::explain": "Explain this in plain language. No jargon. Use metaphors where helpful.",
  "::refactor": "Refactor this code to be cleaner and more readable. Don't change behavior. Explain what you changed and why.",
  "::review": "Review this code for bugs, edge cases, and improvements. List findings in order of importance.",
  "::docs": "Write clear documentation for the changes made in this session. Use the document.md prompt format.",
  "::summarize": "Summarize the conversation so far. Only the key decisions, problems solved, and next steps.",
};

export default function (pi: ExtensionAPI) {
  // Show shortcuts on startup — this popup works the same as observability's
  pi.on("session_start", async (_event, ctx) => {
    const list = Object.keys(SHORTCUTS)
      .map(k => `  ${k} → ${SHORTCUTS[k].slice(0, 40)}...`)
      .join("\n");
    ctx.ui.notify(`Shortcuts loaded:\n${list}`, "info");
  });

  pi.on("input", async (event, ctx) => {
    const text = event.text?.trim();
    if (!text) return;

    // Check if it starts with a known shortcut
    for (const [key, replacement] of Object.entries(SHORTCUTS)) {
      if (text.startsWith(key)) {
        // Replace "::fix" with the expanded text
        // Keep anything after the shortcut (like @file references)
        const rest = text.slice(key.length).trim();
        const expanded = rest ? `${replacement}\n\nRefer to: ${rest}` : replacement;

        event.text = expanded;
        log(`expanded "${key}" → ${expanded.length} chars`);
        return;
      }
    }
  });
}
