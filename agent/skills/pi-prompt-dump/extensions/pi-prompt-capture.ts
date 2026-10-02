/**
 * pi-prompt-capture — opt-in capture of the FINAL assembled system prompt.
 *
 * WHY
 * ---
 * pi persists the prompt to the transcript as structured `sections`, but any
 * extension that returns a `systemPrompt` string from `before_agent_start`
 * (for example @mjakl/pi-subagent appending "## Available Subagents") replaces
 * the rendered string for that run WITHOUT persisting it. A transcript-only
 * replay therefore cannot see request-time injections.
 *
 * This extension observes `before_agent_start` and writes whatever
 * `event.systemPrompt` it receives to a per-session file, so pi-prompt-dump can
 * use a byte-exact capture instead of a reconstruction.
 *
 * IMPORTANT CAVEAT — hook ordering
 * --------------------------------
 * Extensions run in load order. If this handler runs BEFORE another extension's
 * handler, the capture misses that extension's append. The capture therefore
 * records a `markers` map so the consumer can detect incompleteness rather than
 * silently trusting a partial prompt.
 *
 * This extension never mutates the prompt: it always returns undefined, so it
 * cannot affect model behaviour.
 *
 * Installation: copy or symlink into ~/.pi/agent/extensions/, then run /reload.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Markers that reveal whether other extensions already appended their blocks.
const MARKERS = [
  "## Available Subagents",
  "<agent_browser>",
  "<project_context>",
  "<addendum>",
  "<skills>",
];

function captureDir() {
  const explicit = process.env.PI_PROMPT_CAPTURE_DIR?.trim();
  if (explicit) return explicit;
  const configDir = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
  return path.join(configDir, "state", "prompt-capture");
}

export default function (pi) {
  pi.on("before_agent_start", async (event) => {
    try {
      const prompt = event?.systemPrompt;
      if (typeof prompt !== "string" || prompt.length === 0) return undefined;

      const sessionId = process.env.PI_SESSION_ID?.trim() || "no-session";
      const markers = {};
      for (const marker of MARKERS) markers[marker] = prompt.includes(marker);

      const record = {
        capturedAt: new Date().toISOString(),
        sessionId,
        sessionFile: process.env.PI_SESSION_FILE ?? null,
        cwd: event?.systemPromptOptions?.cwd ?? process.cwd(),
        length: prompt.length,
        markers,
        complete: markers["## Available Subagents"] === true,
        sectionNames: Object.keys(event?.systemPromptOptions?.sections ?? {}),
        systemPrompt: prompt,
      };

      const dir = captureDir();
      fs.mkdirSync(dir, { recursive: true });

      // Atomic write so a concurrent reader never sees a partial file.
      const target = path.join(dir, `${sessionId}.json`);
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(record, null, 2), "utf8");
      fs.renameSync(tmp, target);
    } catch {
      // Capture is best-effort; never break a run because of it.
    }
    return undefined;
  });
}
