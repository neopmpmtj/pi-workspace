/**
 * `scripts/speech/host-toggle.sh` behind the shell wrapper: one JSON answer.
 *
 *   status                        -> the whole switch state of this host
 *   set tui|telegram on|off       -> write it, then print the same state
 *
 * The project site calls this locally and over ssh, so it has to be safe to
 * run from a non-interactive shell, print nothing but JSON on stdout, and name
 * its failure in the exit code: 0 done, 2 usage, 3 the file could not be
 * written. The file rules live in speech-switch.ts; this file only formats.
 */
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { fileChoice, persist, persistTelegram, speechEnvPath, telegramChoice } from "./speech-switch.ts";
import { readTelegramVoice, telegramVoicePath } from "./telegram-voice-switch.ts";

interface Snapshot {
  host: string;
  file: string;
  /** PI_SPEECH_TUI: laptop TUI answers. Absent means off, as the extension reads it. */
  tui: boolean;
  /** PI_SPEECH_TELEGRAM: Telegram voice notes. Absent means on, as speak.sh reads it. */
  telegram: boolean;
  speak: "ok" | "missing";
  /** voice.replyMode in telegram.json, read-only: the bridge reads it at startup. */
  mode: string | null;
}

function snapshot(): Snapshot {
  const home = process.env.HOME ?? "";
  return {
    host: hostname(),
    file: speechEnvPath(),
    tui: fileChoice() === true,
    telegram: telegramChoice() !== false,
    speak: existsSync(join(home, ".pi", "agent", "scripts", "speech", "speak.sh")) ? "ok" : "missing",
    mode: existsSync(telegramVoicePath()) ? readTelegramVoice().mode : null,
  };
}

const USAGE = "usage: host-toggle.sh status | set tui|telegram on|off";

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.stdout.write(`${JSON.stringify({ error: message })}\n`);
  process.exit(code);
}

const [action, key, value] = process.argv.slice(2).map((part) => part.trim());

if (action === "status" && key === undefined) {
  process.stdout.write(`${JSON.stringify(snapshot())}\n`);
  process.exit(0);
}

if (action === "set") {
  if (key !== "tui" && key !== "telegram") fail(USAGE, 2);
  if (value !== "on" && value !== "off") fail(USAGE, 2);
  const on = value === "on";
  const problem = key === "tui" ? persist(on) : persistTelegram(on);
  if (problem) fail(`could not write ${speechEnvPath()}: ${problem}`, 3);
  process.stdout.write(`${JSON.stringify(snapshot())}\n`);
  process.exit(0);
}

fail(USAGE, 2);
