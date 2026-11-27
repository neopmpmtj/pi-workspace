/**
 * Speaks a short answer that would otherwise only reach the screen.
 *
 * Used for a calendar/reminder routing outcome that arrives as a *voice* prompt:
 * a routed turn is finished by the node and never reaches the model, so
 * `speech-reply.ts` never sees a final answer to speak. Without this the user
 * would hear nothing after asking by voice.
 *
 * Uses the one speech seam (`scripts/speech/speak.sh --play`), and brackets the
 * playback with `speechStarted()` / `speechFinished()` so the wakeword extension
 * mutes the microphone while the answer plays.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { speechFinished, speechStarted } from "./speech-activity.ts";

const SPEAK = join(homedir(), ".pi", "agent", "scripts", "speech", "speak.sh");

export function speakText(text: string): void {
	const clean = text.trim();
	if (!clean || !existsSync(SPEAK)) return;

	speechStarted();
	try {
		const child = spawn(SPEAK, ["-t", clean, "--play", "--limit", "600"], { stdio: "ignore" });
		child.on("exit", () => speechFinished());
		child.on("error", () => speechFinished());
	} catch {
		speechFinished();
	}
}
