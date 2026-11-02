/**
 * git-diff-shortcut.ts — Injects git diff context on demand.
 *
 * Station: input
 *
 * Type "::diff"  → your message + latest git diff
 * Type "::diff --staged" → your message + staged changes only
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const LOG_FILE = join(import.meta.dirname, "..", "events.log");
const MAX_DIFF_LENGTH = 3000; // truncate huge diffs

function log(msg: string) {
  const ts = new Date().toISOString();
  appendFileSync(LOG_FILE, `[${ts}] GIT_DIFF ${msg}\n`);
}

export default function (pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    const text = event.text?.trim();
    if (!text) return;

    if (!text.startsWith("::diff")) return;

    // Figure out what the user actually wants to ask about
    let userMessage = text.slice("::diff".length).trim();
    if (!userMessage) {
      userMessage = "Review this diff for issues.";
    }

    // Get the diff
    let diffFlags = "";
    let diffLabel = "Changes";
    if (userMessage.includes("--staged") || userMessage.includes("--cached")) {
      diffFlags = "--staged";
      diffLabel = "Staged changes";
      userMessage = userMessage.replace(/--(?:staged|cached)/, "").trim();
      if (!userMessage) userMessage = "Review these staged changes for issues.";
    }

    try {
      const diff = execSync(`git diff ${diffFlags} -- . ':(exclude).pi' ':(exclude)package-lock.json'`, {
        encoding: "utf-8",
        cwd: ctx.cwd,
      });

      if (!diff.trim()) {
        event.text = userMessage + "\n\n(No changes to review.)";
        log("no diff found");
        return;
      }

      const truncated =
        diff.length > MAX_DIFF_LENGTH
          ? diff.slice(0, MAX_DIFF_LENGTH) + `\n... [truncated ${diff.length - MAX_DIFF_LENGTH} more chars]`
          : diff;

      event.text = `${userMessage}\n\n${diffLabel}:\n\`\`\`diff\n${truncated}\`\`\``;
      log(`injected ${diff.length} chars of diff`);
    } catch (err) {
      log(`git diff failed: ${err}`);
      event.text = userMessage + "\n\n(git diff command failed — perhaps no git repo here?)";
    }
  });
}
