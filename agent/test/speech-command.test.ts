import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// The extension resolves ~/.config/pi-speech.env once, at import time, so the
// fake home has to exist before the dynamic import below. Node runs each test
// file in its own process, so this cannot leak into another test.
const home = mkdtempSync(join(tmpdir(), "pi-speech-home-"));
process.env.HOME = home;
delete process.env.PI_SPEECH_TUI;
const envFile = join(home, ".config", "pi-speech.env");
mkdirSync(join(home, ".config"), { recursive: true });
writeFileSync(envFile, "# machine-local\nPI_SPEECH_LANG=en\nPI_SPEECH_TUI=0\n", "utf8");

const { default: registerSpeechReply } = await import("../extensions/speech-reply.ts");

type CommandHandler = (args: string, ctx: unknown) => Promise<void>;

function harness() {
	const commands = new Map<string, { description: string; handler: CommandHandler }>();
	const events: string[] = [];
	const messages: string[] = [];
	const notices: string[] = [];
	const api = {
		registerCommand(name: string, definition: { description: string; handler: CommandHandler }) {
			commands.set(name, definition);
		},
		on(name: string) {
			events.push(name);
		},
		sendMessage(message: { content: string }) {
			messages.push(message.content);
		},
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	};
	// biome-ignore lint: the extension only uses these fields of the API.
	registerSpeechReply(api as never);
	const ctx = {
		hasUI: true,
		ui: { notify: (text: string) => notices.push(text) },
		sessionManager: { getSessionFile: () => join(home, "session.jsonl"), appendMessage: () => 0 },
	};
	const run = async (args?: string): Promise<string> => {
		const command = commands.get("speech");
		assert.ok(command, "/speech must be registered");
		await command.handler(args as string, ctx);
		return messages[messages.length - 1] ?? "";
	};
	const flag = (): string | undefined =>
		/PI_SPEECH_TUI=(\S+)/.exec(readFileSync(envFile, "utf8"))?.[1];
	return { commands, events, messages, notices, run, flag };
}

const { commands, events, run, flag } = harness();

describe("/speech command wiring", () => {
	it("registers the switch and the turn listener even while speech is off", () => {
		assert.ok(commands.has("speech"));
		assert.deepEqual(events, ["turn_end"]);
		assert.match(commands.get("speech")!.description, /speech on/);
	});

	it("reports the state and where it came from", async () => {
		const line = await run("");
		assert.match(line, /^speech off · source ~\/\.config\/pi-speech\.env/m);
	});

	it("turns speech on and saves it", async () => {
		const line = await run("on");
		assert.match(line, /^\[ok\] speech on/m);
		assert.equal(flag(), "1");
		assert.match(await run("status"), /^speech on/m);
	});

	it("turns speech off again", async () => {
		assert.match(await run("off"), /^\[ok\] speech off/m);
		assert.equal(flag(), "0");
		assert.match(await run(), /^speech off/m);
	});

	it("flips with toggle", async () => {
		assert.match(await run("toggle"), /^\[ok\] speech on/m);
		assert.equal(flag(), "1");
		assert.match(await run("toggle"), /^\[ok\] speech off/m);
		assert.equal(flag(), "0");
	});

	it("keeps the rest of the file intact", () => {
		assert.equal(readFileSync(envFile, "utf8"), "# machine-local\nPI_SPEECH_LANG=en\nPI_SPEECH_TUI=0\n");
	});

	it("refuses an argument it does not understand, and changes nothing", async () => {
		assert.match(await run("louder"), /^\[FAIL\] usage: \/speech on/m);
		assert.equal(flag(), "0");
	});

	it("beats a stale shell variable, because the switch is the newest word", async () => {
		process.env.PI_SPEECH_TUI = "0";
		assert.match(await run("on"), /^\[ok\] speech on/m);
		assert.match(await run(), /source this session/);
		delete process.env.PI_SPEECH_TUI;
	});
});
