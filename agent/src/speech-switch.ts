/**
 * The durable laptop speech switch: PI_SPEECH_TUI in ~/.config/pi-speech.env.
 *
 * /speech and the project site both call this. Neither one is allowed to grow
 * a second copy of the rewrite. A running pi session can still hold a choice
 * that beats this file until that process restarts; this module does not
 * know about that choice.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const SPEECH_TUI_KEY = "PI_SPEECH_TUI";

const ON = new Set(["1", "on", "true", "yes"]);
const OFF = new Set(["0", "off", "false", "no"]);

export function speechEnvPath(): string {
  return join(homedir(), ".config", "pi-speech.env");
}

export function parseFlag(raw: string): boolean | undefined {
  const value = raw.trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (ON.has(value)) return true;
  if (OFF.has(value)) return false;
  return undefined;
}

/** PI_SPEECH_TUI as the file states it, or undefined when the file is silent. */
export function fileChoice(file: string = speechEnvPath()): boolean | undefined {
  if (!existsSync(file)) return undefined;
  try {
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const [, key, value] = /^([A-Z0-9_]+)=(.*)$/.exec(line) ?? [];
      if (key === SPEECH_TUI_KEY) return parseFlag(value ?? "");
    }
  } catch {
    // A broken env file must not break the session; stay silent instead.
  }
  return undefined;
}

/**
 * Rewrites the PI_SPEECH_TUI line, keeping every other line and comment.
 * Returns an error message, or undefined when the file was written.
 */
export function persist(value: boolean, file: string = speechEnvPath()): string | undefined {
  try {
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    const lines = current === "" ? [] : current.replace(/\n+$/, "").split("\n");
    const wanted = `${SPEECH_TUI_KEY}=${value ? "1" : "0"}`;
    let replaced = false;
    const out: string[] = [];
    for (const line of lines) {
      const [, key] = /^\s*([A-Z0-9_]+)=/.exec(line) ?? [];
      if (key !== SPEECH_TUI_KEY) out.push(line);
      else if (!replaced) {
        out.push(wanted);
        replaced = true;
      }
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
