/**
 * wakeword.ts — live "Hey Pamela" voice session for the pi TUI.
 *
 * Stations: session_start (arm the wakeword), TRIGGER (start a voice session),
 * SUBMIT (send the transcript as a prompt), END (re-arm), plus `/wakeword` and
 * the `wakeword` tool.
 *
 * The chain:
 *   1. `scripts/wakeword/listen.py` hears "Hey Pamela" and appends TRIGGER to the log.
 *   2. This extension plays `tone1.wav`, releases the mic (`wakewordctl stop`) and
 *      starts `python -m vad --session` in ~/.pi/vad-code. The vad process owns the
 *      voice state machine: it transcribes each phrase, asks JEV whether it is exactly
 *      one request, and prints `SUBMIT {json}` / `END {json}`.
 *   3. On SUBMIT the text is sent with `markVoiceInput`, so calendar/reminder/mode
 *      routing treats it exactly like typed input.
 *   4. The vad process is muted (SIGUSR1) while the agent runs and while its answer is
 *      spoken, then unmuted (SIGUSR2). It never transcribes the agent's own voice.
 *   5. "Pamela off" (or 120 s of silence) ends the session and re-arms the wakeword.
 *
 * One control seam, `scripts/wakeword/wakewordctl`, shared by the command, the tool
 * and a terminal. No `~/.config/pi-wakeword.json`, no microphone (e.g. the VPS).
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { onSpeechChange } from "../src/speech-activity.ts";
import { isVoiceInput, markVoiceInput, stripVoiceMarker } from "../src/voice-input.ts";
import { startTriggerWatch, type TriggerWatch } from "../src/wakeword-watch.ts";

const CTL = join(homedir(), ".pi", "agent", "scripts", "wakeword", "wakewordctl");
const CONFIG = join(homedir(), ".config", "pi-wakeword.json");
const LOG = join(homedir(), ".pi", "agent", "logs", "wakeword.log");
const DEFAULT_TONE = join(homedir(), ".pi", "agent", "scripts", "wakeword", "tone1.wav");
const DEFAULT_VAD_HOME = join(homedir(), ".pi", "vad-code");
const DEFAULT_VAD_PYTHON = join(DEFAULT_VAD_HOME, ".venv", "bin", "python");
const POLL_MS = 350;
/** Actions that must release a live voice session before the ctl runs. */
const SESSION_ENDING = new Set(["on", "enable", "resume", "off", "disable", "pause", "stop", "start", "restart"]);

interface WakewordConfig {
	tone: string;
	capture: boolean;
	vadHome: string;
	vadPython: string;
	sessionIdleS: number;
}

interface VoiceSession {
	child: ChildProcess;
	tonePlayed: boolean;
}

type CtlResult = { ok: boolean; text: string };

let config: WakewordConfig | null = null;
let api: ExtensionAPI | null = null;
let ctxRef: ExtensionContext | null = null;
let session: VoiceSession | null = null;
let muted = false;
let agentBusy = false;
let speechActive = false;
let watch: TriggerWatch | null = null;
let offSpeech: (() => void) | null = null;

function log(line: string): void {
	try {
		mkdirSync(join(homedir(), ".pi", "agent", "logs"), { recursive: true });
		appendFileSync(LOG, `[${new Date().toISOString()}] pi: ${line}\n`);
	} catch {
		// Logging must never break the listener.
	}
}

/** Reads the machine-local config, or null when this host does not opt in. */
function readConfig(): WakewordConfig | null {
	if (!existsSync(CONFIG)) return null;
	try {
		const parsed = JSON.parse(readFileSync(CONFIG, "utf8")) as Record<string, unknown>;
		return {
			tone: typeof parsed.tone === "string" && parsed.tone ? parsed.tone : DEFAULT_TONE,
			capture: parsed.capture !== false,
			vadHome: typeof parsed.vadHome === "string" ? parsed.vadHome : DEFAULT_VAD_HOME,
			vadPython: typeof parsed.vadPython === "string" ? parsed.vadPython : DEFAULT_VAD_PYTHON,
			sessionIdleS: typeof parsed.sessionIdleS === "number" && parsed.sessionIdleS > 0 ? parsed.sessionIdleS : 120,
		};
	} catch (error) {
		log(`config unreadable: ${(error as Error).message}`);
		return null;
	}
}

/** Runs one wakewordctl action. Never throws; the owner pid lets it stop only its own listener. */
function ctl(action: string): Promise<CtlResult> {
	return new Promise((resolve) => {
		if (!existsSync(CTL)) {
			resolve({ ok: false, text: `wakeword: control script missing: ${CTL}` });
			return;
		}
		execFile(
			CTL,
			[action],
			{ timeout: 20_000, env: { ...process.env, PI_WAKEWORD_OWNER: String(process.pid) } },
			(error, stdout, stderr) => {
				const text = [String(stdout ?? ""), String(stderr ?? "")]
					.map((value) => value.trim())
					.filter(Boolean)
					.join("\n");
				resolve({ ok: !error, text: text || (error ? error.message : "(no output)") });
			},
		);
	});
}

/** Plays the cue and resolves when the audio ends (aplay exits). */
function playTone(tone: string): Promise<void> {
	return new Promise((resolve) => {
		if (!existsSync(tone)) {
			resolve();
			return;
		}
		const aplay = existsSync("/usr/bin/aplay");
		const player = aplay ? "/usr/bin/aplay" : "/usr/bin/pw-play";
		const args = aplay ? ["-q", tone] : [tone];
		try {
			const child = spawn(player, args, { stdio: "ignore" });
			child.once("exit", () => resolve());
			child.once("error", () => resolve());
		} catch {
			resolve();
		}
	});
}

// ── Microphone mute (SIGUSR1/SIGUSR2 into the vad process) ──

function setMuted(want: boolean): void {
	if (want === muted || !session?.child.pid) return;
	try {
		process.kill(session.child.pid, want ? "SIGUSR1" : "SIGUSR2");
		muted = want;
		log(want ? "mic muted" : "mic live");
	} catch {
		// The session may have exited between the check and the signal.
	}
}

function applyMute(): void {
	setMuted(agentBusy || speechActive);
}

// ── Voice session ──

function waitExit(child: ChildProcess, ms: number): Promise<void> {
	return new Promise((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) {
			resolve();
			return;
		}
		const timer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				// already gone
			}
			resolve();
		}, ms);
		child.once("exit", () => {
			clearTimeout(timer);
			resolve();
		});
	});
}

async function startSession(): Promise<void> {
	if (session || !config?.capture) return;
	if (agentBusy || speechActive) {
		log("trigger ignored: the agent is speaking");
		return;
	}

	await ctl("stop"); // the wakeword stream must release the microphone first

	let child: ChildProcess;
	try {
		child = spawn(config.vadPython, ["-m", "vad", "--session", "--idle-s", String(config.sessionIdleS)], {
			cwd: config.vadHome,
			env: { ...process.env },
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		log(`could not start vad: ${(error as Error).message}`);
		await ctl("start");
		return;
	}

	const active: VoiceSession = { child, tonePlayed: false };
	session = active;
	muted = false;
	log(`voice session started pid=${child.pid ?? "?"}`);

	child.stderr?.on("data", (chunk: Buffer) => log(`vad stderr: ${String(chunk).trim()}`));
	if (child.stdout) {
		createInterface({ input: child.stdout }).on("line", (line) => onVadLine(active, line));
	}
	child.on("exit", (code, signal) => {
		if (session !== active) return;
		session = null;
		muted = false;
		log(`voice session exited (${signal ?? code})`);
		void ctl("start"); // re-arm the wakeword
	});
	child.on("error", (error) => log(`vad process error: ${error.message}`));
}

function onVadLine(active: VoiceSession, line: string): void {
	if (session !== active) return;

	if (line.startsWith("Ready.")) {
		if (active.tonePlayed) return;
		active.tonePlayed = true;
		void cue();
		return;
	}
	if (line.startsWith("SUBMIT ")) {
		try {
			const payload = JSON.parse(line.slice("SUBMIT ".length)) as { text?: string };
			if (typeof payload.text === "string" && payload.text.trim()) void submit(payload.text.trim());
		} catch {
			log(`bad SUBMIT line: ${line}`);
		}
		return;
	}
	if (line.startsWith("END ")) {
		void endSession("vad");
		return;
	}
	if (line.startsWith("BUFFER ")) log(line);
}

/** The tone marks "speak now": mute across it so the beep is not transcribed. */
async function cue(): Promise<void> {
	setMuted(true);
	await playTone(config?.tone ?? DEFAULT_TONE);
	applyMute();
}

async function submit(text: string): Promise<void> {
	log(`submit: ${text}`);
	if (ctxRef?.hasUI) ctxRef.ui.notify(`voice: ${text}`, "info");
	try {
		await api?.sendUserMessage(markVoiceInput(text));
	} catch (error) {
		log(`sendUserMessage failed: ${(error as Error).message}`);
	}
}

async function endSession(reason: string, rearm = true): Promise<void> {
	const active = session;
	if (!active) return;
	session = null;
	muted = false;
	log(`voice session ending (${reason})`);
	try {
		active.child.kill("SIGTERM");
	} catch {
		// already gone
	}
	await waitExit(active.child, 3000);
	if (rearm) await ctl("start");
}

function control(action: string): Promise<CtlResult> {
	return (async () => {
		if (SESSION_ENDING.has(action) && session) await endSession(`command:${action}`, false);
		return ctl(action);
	})();
}

// ── Trigger watching ──

function startWatch(tone: string): void {
	if (watch) return;
	watch = startTriggerWatch(LOG, () => onTrigger(tone), POLL_MS);
}

function stopWatch(): void {
	watch?.stop();
	watch = null;
}

function onTrigger(tone: string): void {
	if (!config) return;
	if (!config.capture) {
		void playTone(tone);
		return;
	}
	if (session) return; // already in a voice session
	void startSession();
}

export default function registerWakeword(pi: ExtensionAPI): void {
	api = pi;

	pi.on("session_start", async (_event, ctx) => {
		ctxRef = ctx;
		config = readConfig();
		if (!config) return; // this host does not opt in
		if (ctx.mode !== "tui") return; // only an interactive session opens the mic

		const result = await ctl("start");
		if (!result.ok) {
			ctx.ui.notify(`wakeword: ${result.text}`, "error");
			return;
		}
		startWatch(config.tone);
	});

	// Voice prompts are the user speaking: strip the marker before the model sees it.
	pi.on("input", async (event) => {
		if (!isVoiceInput(event.text)) return { action: "continue" };
		return { action: "transform", text: stripVoiceMarker(event.text) };
	});

	pi.on("agent_start", async () => {
		agentBusy = true;
		applyMute();
	});

	pi.on("agent_settled", async () => {
		agentBusy = false;
		applyMute();
	});

	offSpeech = onSpeechChange((speaking) => {
		speechActive = speaking;
		applyMute();
	});

	pi.on("session_shutdown", async (event) => {
		stopWatch();
		offSpeech?.();
		offSpeech = null;
		const reason = (event as { reason?: string }).reason;
		const leaving = !reason || reason === "quit";
		if (session) await endSession("shutdown", !leaving);
		if (leaving) await ctl("stop-if-owner");
	});

	// ── /wakeword ──

	pi.registerCommand("wakeword", {
		description: "Live 'Hey Pamela' voice session: on | off | restart | status | test",
		handler: async (args, ctx) => {
			const action = (args || "status").trim().split(/\s+/)[0]?.toLowerCase() || "status";
			const result = await control(action);
			ctx.ui.notify(result.text, result.ok ? "info" : "error");
		},
	});

	// ── wakeword tool ──

	pi.registerTool({
		name: "wakeword",
		label: "Wakeword",
		description: `Control the live "Hey Pamela" voice session on this laptop.

ACTIONS:
- on (aliases enable, resume): arm the wakeword and start listening now; persists for later sessions
- off (aliases disable, pause): stop it now, end a live voice session, and keep it off next session
- restart: end the session, then stop and start the listener (use after a threshold/model change)
- status: enabled, running, pid, threshold, last trigger line
- test: play the cue tone once (no microphone)

The listener opens the microphone; on "Hey Pamela" it plays a tone, then the voice pipeline
transcribes what you say and submits it as a prompt. "okay go" submits whatever is buffered,
"Pamela off" ends the voice session. No audio is stored.`,
		parameters: Type.Object({
			action: Type.String({ description: "Action: on, off, restart, status, test" }),
		}),
		async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
			const action = String(params.action || "status");
			const result = await control(action);
			return {
				content: [{ type: "text" as const, text: result.text }],
				details: { action, ok: result.ok },
			};
		},
	});
}
