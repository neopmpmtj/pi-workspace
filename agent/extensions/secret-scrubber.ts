/**
 * secret-scrubber.ts — Redacts secrets from tool outputs before the AI sees them.
 *
 * Station: tool_result (conveyor belt — after tool runs, before AI receives output)
 *
 * Real-world use: you "cat" a .env file with API keys.
 * This extension strips them so they never reach the AI provider.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const LOG_FILE = join(import.meta.dirname, "..", "events.log");

function log(msg: string) {
  const ts = new Date().toISOString();
  appendFileSync(LOG_FILE, `[${ts}] SCRUBBER ${msg}\n`);
}

/**
 * Patterns that look like secrets.
 * Each regex captures the value so we can redact it.
 */
const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  {
    name: "OpenAI API key",
    regex: /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/g,
  },
  {
    name: "Anthropic API key",
    regex: /sk-ant-[A-Za-z0-9_-]{32,}/g,
  },
  {
    name: "GitHub token",
    regex: /ghp_[A-Za-z0-9]{36}/g,
  },
  {
    name: "AWS key",
    regex: /AKIA[0-9A-Z]{16}/g,
  },
  {
    name: "Generic key=value in .env",
    regex: /\b([A-Z_]+_(?:KEY|SECRET|TOKEN|PASSWORD))\s*=\s*["']?([^"'\n]+)["']?/gi,
  },
  {
    name: "JWT token",
    regex: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g,
  },
];

export default function (pi: ExtensionAPI) {
  pi.on("tool_result", async (event, ctx) => {
    if (!event.content) return;

    let redactions = 0;

    for (const block of event.content) {
      if (block.type !== "text" || !block.text) continue;

      for (const { name, regex } of SECRET_PATTERNS) {
        // Reset regex state (global flag keeps lastIndex between calls)
        regex.lastIndex = 0;

        const matches = block.text.match(regex);
        if (matches && matches.length > 0) {
          redactions += matches.length;
          block.text = block.text.replace(regex, "[REDACTED]");
        }
      }
    }

    if (redactions > 0) {
      log(`redacted ${redactions} secret(s) from ${event.toolName} output`);
    }
  });
}
