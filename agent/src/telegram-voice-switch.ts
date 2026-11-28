/**
 * Laptop Telegram voice reply mode, in ~/.pi/agent/telegram.json.
 *
 * The installed bridge (@llblab/pi-telegram) accepts manual, mirror, and always.
 * Spoken-on for this switch is always. Spoken-off is manual: mirror still speaks
 * when the user sent a voice note, and legacy hidden is read as off.
 * A missing file is reported and never created. Every other field stays.
 */
import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const TELEGRAM_VOICE_ON = "always";
export const TELEGRAM_VOICE_OFF = "manual";

export function telegramVoicePath(home: string = homedir()): string {
  return join(home, ".pi", "agent", "telegram.json");
}

export interface TelegramVoiceState {
  missing: boolean;
  on: boolean;
  mode: string | null;
  error?: string;
}

export function readTelegramVoice(file: string = telegramVoicePath()): TelegramVoiceState {
  if (!existsSync(file)) return { missing: true, on: false, mode: null };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { missing: false, on: false, mode: null, error: "telegram.json is not an object" };
    }
    const voice = (parsed as { voice?: unknown }).voice;
    if (voice === undefined) return { missing: false, on: false, mode: null };
    if (!voice || typeof voice !== "object" || Array.isArray(voice)) {
      return { missing: false, on: false, mode: null, error: "voice is not an object" };
    }
    const mode = (voice as { replyMode?: unknown }).replyMode;
    const text = typeof mode === "string" ? mode : null;
    return { missing: false, on: text === TELEGRAM_VOICE_ON, mode: text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { missing: false, on: false, mode: null, error: message };
  }
}

/** Writes voice.replyMode only. Returns an error message, or undefined on success. */
export function writeTelegramVoice(on: boolean, file: string = telegramVoicePath()): string | undefined {
  if (!existsSync(file)) return "telegram.json is missing";
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "telegram.json is not an object";
    const cfg = parsed as { voice?: unknown };
    if (cfg.voice === undefined) cfg.voice = {};
    if (!cfg.voice || typeof cfg.voice !== "object" || Array.isArray(cfg.voice)) return "voice is not an object";
    (cfg.voice as { replyMode?: string }).replyMode = on ? TELEGRAM_VOICE_ON : TELEGRAM_VOICE_OFF;
    const mode = statSync(file).mode & 0o777;
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
    chmodSync(tmp, mode || 0o600);
    renameSync(tmp, file);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
