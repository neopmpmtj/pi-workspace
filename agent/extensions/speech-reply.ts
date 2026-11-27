/**
 * speech-reply.ts — speak each final answer through this host's speakers.
 *
 * Station: turn_end (after the assistant persisted its response)
 *
 * Why: the user's eyesight is degrading, so a TUI answer that is only text is
 * unreadable on the laptop. This extension hands the final answer to the one
 * speech seam (`agent/scripts/speech/speak.sh --play`) that every surface
 * shares. It adds no synthesis of its own: swap the voice in speak.sh, and
 * Telegram, the laptop and the home server all change together.
 *
 * Off unless this host opts in, because a headless server has no speakers and
 * the VPS delivers speech through Telegram voice notes instead:
 *
 *     # ~/.config/pi-speech.env   (machine-local, outside the repo)
 *     PI_SPEECH_TUI=1
 *
 * `PI_SPEECH_TUI=0` or a missing file means: never speak, never spawn.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { speechFinished, speechStarted } from "../src/speech-activity.ts";

const SPEECH_ENV = join(homedir(), ".config", "pi-speech.env");
const SPEAK = join(homedir(), ".pi", "agent", "scripts", "speech", "speak.sh");
const LIMIT = "1200";

/** Reads PI_SPEECH_TUI from the machine-local speech env file. */
function tuiSpeechEnabled(): boolean {
  if (process.env.PI_SPEECH_TUI === "1") return true;
  if (process.env.PI_SPEECH_TUI === "0") return false;
  if (!existsSync(SPEECH_ENV)) return false;
  try {
    for (const raw of readFileSync(SPEECH_ENV, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const [, key, value] = /^([A-Z0-9_]+)=(.*)$/.exec(line) ?? [];
      if (key === "PI_SPEECH_TUI") return value?.replace(/^["']|["']$/g, "") === "1";
    }
  } catch {
    // A broken env file must not break the session; stay silent instead.
  }
  return false;
}

/** Assistant text parts only: tool calls, thinking and images are not speech. */
function assistantText(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: string; text: string } =>
        !!part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

export default function (pi: ExtensionAPI) {
  if (!tuiSpeechEnabled()) return;
  if (!existsSync(SPEAK)) return;

  // Answers play one after another; never two voices at once.
  let queue: Promise<unknown> = Promise.resolve();

  pi.on("turn_end", async (event, ctx) => {
    if (event.outcome !== "completed") return;
    // Only the final answer of a turn: a response that still wants tools is
    // thinking out loud, not talking to the user.
    if (event.toolResults.length > 0) return;

    const text = assistantText(event.message).trim();
    if (!text) return;

    queue = queue.then(async () => {
      const out = join(homedir(), ".pi", "agent", "tmp", `spoken-${Date.now()}.ogg`);
      // Tells the wakeword extension to mute the microphone for the whole playback.
      speechStarted();
      const result = await pi
        .exec(SPEAK, ["-t", text, "-o", out, "--play", "--limit", LIMIT], { timeout: 180_000 })
        .catch(() => undefined)
        .finally(() => speechFinished());
      // Silence must never be silent: a real failure shows up in the TUI.
      if (result && result.code !== 0) {
        const detail = (result.stderr || result.stdout || "").trim().split("\n")[0];
        try {
          ctx.ui.notify(`speech failed: ${detail || `exit ${result.code}`}`, "warning");
        } catch {
          // The turn's context may already be gone; nothing else to do.
        }
      }
    });
  });
}
