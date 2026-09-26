/**
 * interactive-guard.ts — Asks before running dangerous commands.
 *
 * Station: tool_call
 *
 * Unlike safety-guard.ts (which always blocks), this shows a yes/no popup.
 * If the user says Yes → command runs. No → blocked.
 * Falls back to blocking if no UI is available (print mode, etc.).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DANGEROUS_PATTERNS = [
  { pattern: /\brm\s+-rf?\b/,          reason: "recursive delete — could wipe important files" },
  { pattern: /\bsudo\b/,                reason: "sudo — running as root can damage the system" },
  { pattern: /\bmkfs\b/,                reason: "mkfs — formatting destroys all data on the drive" },
  { pattern: /\bdd\s+if=/,              reason: "dd — raw disk writes can corrupt partitions" },
  { pattern: />\s*\/dev\/sd/,           reason: "writing directly to a disk device" },
  { pattern: /\bchmod\s+.*\/etc\//,      reason: "chmod on /etc — changing system permissions" },
];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    const command = (event.input as any).command as string;
    if (!command) return;

    for (const { pattern, reason } of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        if (ctx.hasUI) {
          // Interactive mode: ask the user
          const allow = await ctx.ui.confirm(
            `⚠ Dangerous command detected:\n\n${command.trim()}\n\n${reason}\n\nRun anyway?`,
          );
          if (!allow) {
            return { block: true, reason: `User cancelled: ${reason}` };
          }
          // User said yes — let it through
        } else {
          // Non-interactive: block automatically
          return { block: true, reason: `Blocked: ${reason}` };
        }
        return;
      }
    }
  });

  // Also guard user_bash (! commands)
  pi.on("user_bash", async (event, ctx) => {
    const command = event.command;
    if (!command) return;

    for (const { pattern, reason } of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        if (ctx.hasUI) {
          const allow = await ctx.ui.confirm(
            `⚠ Dangerous command detected:\n\n${command.trim()}\n\n${reason}\n\nRun anyway?`,
          );
          if (!allow) {
            return {
              result: { exitCode: 1, stdout: "", stderr: `Cancelled: ${reason}` },
            };
          }
        } else {
          return {
            result: { exitCode: 1, stdout: "", stderr: `Blocked: ${reason}` },
          };
        }
        return;
      }
    }
  });
}
