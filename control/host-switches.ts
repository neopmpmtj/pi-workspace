/**
 * Host switches for the project site. Speech and Telegram write their own files.
 * Wakeword goes through wakewordctl, the same script /wakeword uses.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileChoice, persist } from "../agent/src/speech-switch.ts";
import { readTelegramVoice, writeTelegramVoice, type TelegramVoiceState } from "../agent/src/telegram-voice-switch.ts";
import { SettingsError } from "./store.ts";

export const WAKEWORD_CTL = join(homedir(), ".pi", "agent", "scripts", "wakeword", "wakewordctl");

export interface WakewordState {
  enabled: boolean;
  running: boolean;
  error?: string;
}

export function readHostSpeech(): { on: boolean } {
  return { on: fileChoice() === true };
}

export function writeHostSpeech(on: boolean): { on: boolean } {
  const problem = persist(on);
  if (problem) throw new SettingsError(problem);
  return readHostSpeech();
}

export function readHostTelegram(): TelegramVoiceState {
  return readTelegramVoice();
}

export function writeHostTelegram(on: boolean): TelegramVoiceState {
  const problem = writeTelegramVoice(on);
  if (problem) throw new SettingsError(problem);
  return readHostTelegram();
}

export function requireOn(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SettingsError("Body needs { on: true | false }.");
  }
  const on = (body as { on?: unknown }).on;
  if (typeof on !== "boolean") throw new SettingsError("Body needs { on: true | false }.");
  return on;
}

/** Reads enabled= and running= from a wakewordctl status line. */
export function parseWakewordStatus(text: string): { enabled: boolean; running: boolean } {
  const match = /^enabled=(\S+)\s+running=(\S+)/m.exec(text);
  return { enabled: match?.[1] === "true", running: match?.[2] === "true" };
}

export function runWakeword(action: "status" | "on" | "off", script: string = WAKEWORD_CTL): Promise<{ ok: boolean; text: string }> {
  return new Promise((resolve) => {
    if (!existsSync(script)) {
      resolve({ ok: false, text: `wakeword: control script missing: ${script}` });
      return;
    }
    execFile(script, [action], { timeout: 20_000 }, (error, stdout, stderr) => {
      const text = [stdout, stderr]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .join("\n");
      resolve({ ok: !error, text: text || (error ? error.message : "") });
    });
  });
}

export async function readWakeword(script: string = WAKEWORD_CTL): Promise<WakewordState> {
  const result = await runWakeword("status", script);
  const parsed = parseWakewordStatus(result.text);
  if (!result.ok) return { ...parsed, error: result.text || "wakewordctl failed" };
  return parsed;
}

export async function writeWakeword(on: boolean, script: string = WAKEWORD_CTL): Promise<WakewordState> {
  const result = await runWakeword(on ? "on" : "off", script);
  if (!result.ok) throw new SettingsError(result.text || "wakewordctl failed");
  return readWakeword(script);
}
