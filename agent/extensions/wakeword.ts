/**
 * wakeword.ts — live "Hey Pamela" listener for the pi TUI.
 *
 * Station: session_start (arm), session_shutdown (disarm), plus `/wakeword` and
 * a `wakeword` tool.
 *
 * What happens: at the start of an interactive session, `scripts/wakeword/wakewordctl
 * start` opens the microphone through the trained openWakeWord model. When the
 * model fires, `listen.py` appends a `TRIGGER` line to the log; this extension
 * watches that log and plays `tone1.wav` through the speakers. Nothing is
 * transcribed, stored, or sent to a model.
 *
 * There is one control seam, `scripts/wakeword/wakewordctl`, shared by the
 * command, the tool and a terminal. It owns the pidfile, the log and the
 * `enabled` flag, so `/wakeword off` persists across sessions and the model can
 * be re-armed without editing code.
 *
 * Off on any host without `~/.config/pi-wakeword.json` (the VPS, for example):
 * no config, no listener, no microphone. The extension stays loaded and silent.
 *
 * A session stops the listener on quit only if that session started it
 * (`owner=` in the pidfile). A short-lived `pi --print` run or a second TUI
 * window therefore cannot take the microphone away from the session that armed it.
 */

import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { startTriggerWatch, type TriggerWatch } from "../src/wakeword-watch.ts";

const CTL = join(homedir(), ".pi", "agent", "scripts", "wakeword", "wakewordctl");
const CONFIG = join(homedir(), ".config", "pi-wakeword.json");
const LOG = join(homedir(), ".pi", "agent", "logs", "wakeword.log");
const DEFAULT_TONE = join(homedir(), ".pi", "agent", "scripts", "wakeword", "tone1.wav");
const POLL_MS = 350;

type CtlResult = { ok: boolean; text: string };

/** Reads the machine-local config, or null when this host does not opt in. */
function readConfig(): { tone: string } | null {
	if (!existsSync(CONFIG)) return null;
	try {
		const parsed = JSON.parse(readFileSync(CONFIG, "utf8")) as { tone?: string };
		return { tone: parsed.tone || DEFAULT_TONE };
	} catch {
		return { tone: DEFAULT_TONE };
	}
}

/** Runs one wakewordctl action; never throws. The owner pid lets it stop only its own listener. */
function ctl(action: string): Promise<CtlResult> {
	return new Promise((resolve) => {
		if (!existsSync(CTL)) {
			resolve({ ok: false, text: `wakeword: control script missing: ${CTL}` });
			return;
		}
		execFile(
			CTL,
			[action],
			{ timeout: 15_000, env: { ...process.env, PI_WAKEWORD_OWNER: String(process.pid) } },
			(error, stdout, stderr) => {
				const text = [String(stdout ?? ""), String(stderr ?? "")].map((s) => s.trim()).filter(Boolean).join("\n");
				resolve({ ok: !error, text: text || (error ? error.message : "(no output)") });
			},
		);
	});
}

/** Plays the cue without blocking the turn. aplay first, PipeWire as fallback. */
function playTone(tone: string): void {
	if (!existsSync(tone)) return;
	const [player, args] = existsSync("/usr/bin/aplay")
		? ["/usr/bin/aplay", ["-q", tone]]
		: ["/usr/bin/pw-play", [tone]];
	try {
		spawn(player, args, { stdio: "ignore", detached: true }).unref();
	} catch {
		// A missing speaker is not a session failure; the trigger is still in the log.
	}
}

// ── Trigger watching ──
//
// The listener is owned by the ctl, not by this process, so the only channel
// back is its log (src/wakeword-watch.ts). That keeps the mic alive across
// /reload and a restart from another surface.

let watch: TriggerWatch | null = null;

function startWatch(tonePath: string): void {
	if (watch) return;
	watch = startTriggerWatch(LOG, () => playTone(tonePath), POLL_MS);
}

function stopWatch(): void {
	watch?.stop();
	watch = null;
}

export default function registerWakeword(pi: ExtensionAPI): void {
	let tone = DEFAULT_TONE;

	pi.on("session_start", async (_event, ctx) => {
		const config = readConfig();
		if (!config) return; // this host does not opt in
		tone = config.tone;
		if (ctx.mode !== "tui") return; // only an interactive session opens the mic

		const result = await ctl("start");
		if (!result.ok) {
			ctx.ui.notify(`wakeword: ${result.text}`, "error");
			return;
		}
		startWatch(tone);
	});

	pi.on("session_shutdown", async (event) => {
		stopWatch();
		// A session switch or reload keeps the process alive; the next session_start reuses
		// the same listener. Only a real exit releases the microphone.
		const reason = (event as { reason?: string }).reason;
		if (reason && reason !== "quit") return;
		await ctl("stop-if-owner");
	});

	// ── /wakeword ──

	pi.registerCommand("wakeword", {
		description: "Live 'Hey Pamela' listener: on | off | restart | status | test",
		handler: async (args, ctx) => {
			const action = (args || "status").trim().split(/\s+/)[0]?.toLowerCase() || "status";
			const result = await ctl(action);
			ctx.ui.notify(result.text, result.ok ? "info" : "error");
		},
	});

	// ── wakeword tool ──

	pi.registerTool({
		name: "wakeword",
		label: "Wakeword",
		description: `Control the live "Hey Pamela" wakeword listener on this laptop.

ACTIONS:
- on (aliases enable, resume): arm it and start listening now; persists for later sessions
- off (aliases disable, pause): stop it now and keep it off at the next session
- restart: stop then start; use after editing the threshold/model in ~/.config/pi-wakeword.json
- status: enabled, running, pid, threshold, last trigger line
- test: play the cue tone once (no microphone)

The listener opens the microphone and plays a tone when it hears the phrase. It does not transcribe or store audio. Use \`off\` when the user wants the microphone released or the wakeword paused, and \`on\` to arm it again.`,
		parameters: Type.Object({
			action: Type.String({ description: "Action: on, off, restart, status, test" }),
		}),
		async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
			const result = await ctl(String(params.action || "status"));
			return {
				content: [{ type: "text" as const, text: result.text }],
				details: { action: params.action, ok: result.ok },
			};
		},
	});
}
