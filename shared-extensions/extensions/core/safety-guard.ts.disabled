/**
 * safety-guard.ts — Blocks dangerous bash commands.
 *
 * Listens on the tool_call conveyor belt station.
 * When the AI (or user via !) tries to run a dangerous command,
 * we block it and explain why.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const LOG_FILE = join(import.meta.dirname, "..", "events.log");

function log(msg: string) {
  const ts = new Date().toISOString();
  appendFileSync(LOG_FILE, `[${ts}] SAFETY ${msg}\n`);
}

/**
 * Patterns we consider dangerous.
 * Each has a pattern (regex) and a human-readable reason.
 */
const DANGEROUS_PATTERNS = [
  {
    pattern: /\brm\s+-rf?\b/,
    reason: "recursive delete (rm -rf) — could wipe important files",
  },
  {
    pattern: /\bsudo\b/,
    reason: "sudo — running commands as root can damage the system",
  },
  {
    pattern: /\bmkfs\b/,
    reason: "mkfs — formatting a filesystem destroys all data on it",
  },
  {
    pattern: /\bdd\s+if=/,
    reason: "dd — raw disk writes can corrupt partitions",
  },
  {
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,
    reason: "fork bomb — would crash the system",
  },
  {
    pattern: />\s*\/dev\/sd/,
    reason: "writing directly to a disk device can destroy data",
  },
  {
    pattern: /\bchmod\s+.*\/etc\//,
    reason: "chmod on /etc — changing permissions on system config",
  },
];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    // Only guard bash commands
    if (event.toolName !== "bash") return;

    const command = (event.input as any).command as string;
    if (!command) return;

    // Check each pattern
    for (const { pattern, reason } of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        log(`BLOCKED: ${command.trim()}`);
        log(`  reason: ${reason}`);

        return {
          block: true,
          reason: `Safety guard blocked this command: ${reason}`,
        };
      }
    }

    // Command is safe
    log(`ALLOWED: ${command.trim()}`);
  });

  /**
   * user_bash — fires when the user types !command (not through the AI).
   * Same safety checks apply.
   */
  pi.on("user_bash", async (event, ctx) => {
    const command = event.command;
    if (!command) return;

    for (const { pattern, reason } of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        log(`BLOCKED (user): ${command.trim()}`);
        log(`  reason: ${reason}`);
        // Return a no-op result to prevent execution
        return {
          result: {
            exitCode: 1,
            output: `Safety guard blocked: ${reason}`,
          },
        };
      }
    }

    log(`ALLOWED (user): ${command.trim()}`);
  });
}
