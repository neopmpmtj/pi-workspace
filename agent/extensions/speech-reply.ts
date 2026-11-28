/**
 * speech-reply.ts — speak each final answer through this host's speakers,
 * with a live switch: `/speech on` · `/speech off` · `/speech` (status).
 *
 * Station: turn_end (after the assistant persisted its response) + /speech
 *
 * Why: the user's eyesight is degrading, so a TUI answer that is only text is
 * unreadable on the laptop. This extension hands the final answer to the one
 * speech seam (`agent/scripts/speech/speak.sh --play`) that every surface
 * shares. It adds no synthesis of its own: swap the voice in speak.sh, and
 * Telegram, the laptop and the home server all change together.
 *
 * Off unless this host opts in, because a headless server has no speakers and
 * the VPS delivers speech through Telegram voice notes instead. The durable
 * store is machine-local, outside the repo:
 *
 *     # ~/.config/pi-speech.env
 *     PI_SPEECH_TUI=1
 *
 * `/speech on|off` rewrites that line and also takes effect at once, for this
 * session, with no restart: the gate is read on every turn, and a session
 * choice wins over the file and over a stale $PI_SPEECH_TUI. `PI_SPEECH_TUI=0`
 * or a missing file means: never speak, never spawn.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { recordCommandIfUnsaved } from "../src/session-command.ts";
import { speechFinished, speechStarted } from "../src/speech-activity.ts";

const SPEECH_ENV = join(homedir(), ".config", "pi-speech.env");
const SPEAK = join(homedir(), ".pi", "agent", "scripts", "speech", "speak.sh");
const LIMIT = "1200";
const KEY = "PI_SPEECH_TUI";

const ON = new Set(["1", "on", "true", "yes"]);
const OFF = new Set(["0", "off", "false", "no"]);

/** The answer `/speech` gave in this session: live, and beats everything else. */
let sessionChoice: boolean | undefined;

export function parseFlag(raw: string): boolean | undefined {
  const value = raw.trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (ON.has(value)) return true;
  if (OFF.has(value)) return false;
  return undefined;
}

/** PI_SPEECH_TUI as the machine-local file states it, or undefined if silent. */
export function fileChoice(file: string = SPEECH_ENV): boolean | undefined {
  if (!existsSync(file)) return undefined;
  try {
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const [, key, value] = /^([A-Z0-9_]+)=(.*)$/.exec(line) ?? [];
      if (key === KEY) return parseFlag(value ?? "");
    }
  } catch {
    // A broken env file must not break the session; stay silent instead.
  }
  return undefined;
}

/** Where the effective answer came from, for `/speech` status. */
function resolve(): { on: boolean; source: string } {
  if (sessionChoice !== undefined) return { on: sessionChoice, source: "this session (/speech)" };
  const fromEnv = parseFlag(process.env[KEY] ?? "");
  if (fromEnv !== undefined) return { on: fromEnv, source: `$${KEY}` };
  const fromFile = fileChoice();
  if (fromFile !== undefined) return { on: fromFile, source: "~/.config/pi-speech.env" };
  return { on: false, source: `~/.config/pi-speech.env (no ${KEY})` };
}

/** Read on every turn, never cached at load: that is what makes /speech hot. */
function tuiSpeechEnabled(): boolean {
  return resolve().on;
}

/**
 * Rewrites the PI_SPEECH_TUI line in the machine-local file, keeping every
 * other line and comment, atomically. Returns an error message or undefined.
 */
export function persist(value: boolean, file: string = SPEECH_ENV): string | undefined {
  try {
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    const lines = current === "" ? [] : current.replace(/\n+$/, "").split("\n");
    const wanted = `${KEY}=${value ? "1" : "0"}`;
    let replaced = false;
    const out: string[] = [];
    for (const line of lines) {
      const [, key] = /^\s*([A-Z0-9_]+)=/.exec(line) ?? [];
      if (key !== KEY) out.push(line);
      else if (!replaced) {
        out.push(wanted);
        replaced = true;
      }
      // A duplicate PI_SPEECH_TUI is dropped: only the first one would be read.
    }
    if (!replaced) out.push(wanted);
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${out.join("\n")}\n`, "utf8");
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
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

function statusLine(): string {
  const { on, source } = resolve();
  const engine = existsSync(SPEAK) ? "speak.sh ok" : "speak.sh MISSING";
  return `speech ${on ? "on" : "off"} · source ${source} · ${engine}`;
}

function show(pi: ExtensionAPI, ctx: ExtensionCommandContext, text: string, command: string): void {
  if (!ctx.hasUI) writeSync(1, `${text}\n`);
  recordCommandIfUnsaved(ctx.sessionManager, command);
  pi.sendMessage({ customType: "speech", content: text, display: true }, { triggerTurn: false });
}

function fail(pi: ExtensionAPI, ctx: ExtensionCommandContext, text: string, command: string): void {
  recordCommandIfUnsaved(ctx.sessionManager, command);
  ctx.ui.notify(text, "error");
  console.error(`[FAIL] ${text}`);
  if (!ctx.hasUI) process.exitCode = 1;
  pi.sendMessage({ customType: "speech", content: `[FAIL] ${text}`, display: true }, { triggerTurn: false });
}

function apply(pi: ExtensionAPI, ctx: ExtensionCommandContext, want: boolean, command: string): void {
  sessionChoice = want;
  const problem = persist(want);
  if (problem) {
    // The switch still works for this session; say plainly that it did not stick.
    show(pi, ctx, `[warn] speech ${want ? "on" : "off"} for this session · could not write ${SPEECH_ENV}: ${problem}`, command);
    return;
  }
  show(
    pi,
    ctx,
    want
      ? `[ok] speech on — laptop answers are spoken from now on (${KEY}=1 saved)`
      : `[ok] speech off — laptop answers stay silent from now on (${KEY}=0 saved) · Telegram is unaffected`,
    command,
  );
}

export default function (pi: ExtensionAPI) {
  // Registered before any gate: /speech on has to work while speech is off.
  pi.registerCommand("speech", {
    description: "Laptop TUI speech: /speech on · /speech off · /speech (status)",
    handler: async (args, ctx) => {
      // A bare /speech may arrive with no argument at all; treat that as status.
      const trimmed = (args ?? "").trim();
      const command = trimmed ? `/speech ${trimmed}` : "/speech";
      const arg = (trimmed.split(/\s+/)[0] ?? "").toLowerCase();

      if (arg === "" || arg === "status") {
        show(pi, ctx, statusLine(), command);
        return;
      }
      if (arg === "toggle") {
        apply(pi, ctx, !tuiSpeechEnabled(), command);
        return;
      }
      const want = parseFlag(arg);
      if (want === undefined) {
        fail(pi, ctx, `usage: /speech on | /speech off | /speech status — got "${arg}"`, command);
        return;
      }
      apply(pi, ctx, want, command);
    },
  });

  // Answers play one after another; never two voices at once.
  let queue: Promise<unknown> = Promise.resolve();

  pi.on("turn_end", async (event, ctx) => {
    // Checked per turn, not at load, so /speech off silences the very next answer.
    if (!tuiSpeechEnabled()) return;
    if (!existsSync(SPEAK)) return;
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
