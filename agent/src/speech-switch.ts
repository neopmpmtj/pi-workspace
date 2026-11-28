/**
 * The durable speech switches in ~/.config/pi-speech.env (machine-local).
 *
 * Two keys, two surfaces, one writer:
 *
 *   PI_SPEECH_TUI=1|0        laptop TUI answers, read by extensions/speech-reply.ts
 *   PI_SPEECH_TELEGRAM=1|0   Telegram voice notes, read by scripts/speech/speak.sh
 *
 * /speech, the project site and scripts/speech/host-toggle.sh all call this.
 * None of them may grow a second copy of the rewrite. A running pi session can
 * still hold a TUI choice that beats this file until that process restarts;
 * this module does not know about that choice.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const SPEECH_TUI_KEY = "PI_SPEECH_TUI";
export const SPEECH_TELEGRAM_KEY = "PI_SPEECH_TELEGRAM";

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

/** The named key as the file states it, or undefined when the file is silent. */
export function envFlag(key: string, file: string = speechEnvPath()): boolean | undefined {
  if (!existsSync(file)) return undefined;
  try {
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const [, name, value] = /^([A-Z0-9_]+)=(.*)$/.exec(line) ?? [];
      if (name === key) return parseFlag(value ?? "");
    }
  } catch {
    // A broken env file must not break the session; stay silent instead.
  }
  return undefined;
}

/** When the env file last changed, in ms since epoch (0 when it is missing). */
export function speechEnvMtime(file: string = speechEnvPath()): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Rewrites one key's line, keeping every other line and comment, atomically.
 * Returns an error message, or undefined when the file was written.
 */
export function writeEnvFlag(key: string, on: boolean, file: string = speechEnvPath()): string | undefined {
  try {
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    const lines = current === "" ? [] : current.replace(/\n+$/, "").split("\n");
    const wanted = `${key}=${on ? "1" : "0"}`;
    let replaced = false;
    const out: string[] = [];
    for (const line of lines) {
      const [, name] = /^\s*([A-Z0-9_]+)=/.exec(line) ?? [];
      if (name !== key) out.push(line);
      else if (!replaced) {
        out.push(wanted);
        replaced = true;
      }
      // A duplicate of this key is dropped: only the first one would be read.
    }
    if (!replaced) out.push(wanted);
    const mode = existsSync(file) ? statSync(file).mode & 0o777 : 0o600;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${out.join("\n")}\n`, "utf8");
    chmodSync(tmp, mode || 0o600);
    renameSync(tmp, file);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** PI_SPEECH_TUI as the file states it, or undefined when the file is silent. */
export function fileChoice(file: string = speechEnvPath()): boolean | undefined {
  return envFlag(SPEECH_TUI_KEY, file);
}

export function persist(value: boolean, file: string = speechEnvPath()): string | undefined {
  return writeEnvFlag(SPEECH_TUI_KEY, value, file);
}

/** PI_SPEECH_TELEGRAM as the file states it; absent means on (no gate). */
export function telegramChoice(file: string = speechEnvPath()): boolean | undefined {
  return envFlag(SPEECH_TELEGRAM_KEY, file);
}

export function persistTelegram(value: boolean, file: string = speechEnvPath()): string | undefined {
  return writeEnvFlag(SPEECH_TELEGRAM_KEY, value, file);
}
