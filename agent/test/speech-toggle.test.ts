import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileChoice, parseFlag, persist, persistTelegram, speechEnvMtime, telegramChoice } from "../src/speech-switch.ts";

function tempEnv(contents?: string): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-speech-toggle-"));
	const file = join(dir, "pi-speech.env");
	if (contents !== undefined) writeFileSync(file, contents, "utf8");
	return file;
}

describe("speech toggle flag parsing", () => {
	it("accepts the words and numbers a person would type", () => {
		for (const on of ["1", "on", "ON", " true ", '"yes"']) assert.equal(parseFlag(on), true, on);
		for (const off of ["0", "off", "Off", "false", "'no'"]) assert.equal(parseFlag(off), false, off);
	});

	it("treats anything else as no answer at all", () => {
		for (const junk of ["", "maybe", "2", "#on"]) assert.equal(parseFlag(junk), undefined, junk);
	});
});

describe("speech toggle persistence", () => {
	it("appends the key to a file that only has comments", () => {
		const file = tempEnv("# pi speech — machine-local.\nPI_SPEECH_LANG=en\n");
		assert.equal(persist(true, file), undefined);
		const text = readFileSync(file, "utf8");
		assert.match(text, /\nPI_SPEECH_TUI=1\n$/);
		assert.match(text, /^# pi speech — machine-local\./m, "the comment survives");
		assert.match(text, /^PI_SPEECH_LANG=en$/m, "the other setting survives");
		assert.equal(fileChoice(file), true, "the same file now says on");
	});

	it("replaces the existing line instead of adding a second one", () => {
		const file = tempEnv("PI_SPEECH_TUI=1\nPI_SPEECH_LANG=pt\n");
		assert.equal(persist(false, file), undefined);
		const text = readFileSync(file, "utf8");
		assert.equal(text, "PI_SPEECH_TUI=0\nPI_SPEECH_LANG=pt\n");
		assert.equal(fileChoice(file), false);
	});

	it("drops a duplicate line so only the one we wrote is read", () => {
		const file = tempEnv("PI_SPEECH_TUI=1\nPI_SPEECH_TUI=0\n");
		assert.equal(persist(true, file), undefined);
		assert.equal(readFileSync(file, "utf8"), "PI_SPEECH_TUI=1\n");
		assert.equal(fileChoice(file), true);
	});

	it("creates the file when the host never had one", () => {
		const file = tempEnv();
		assert.equal(persist(true, file), undefined);
		assert.equal(readFileSync(file, "utf8"), "PI_SPEECH_TUI=1\n");
		assert.equal(statSync(file).mode & 0o777, 0o600, "mode stays private");
	});

	it("reports silence when the key is absent", () => {
		assert.equal(fileChoice(tempEnv("PI_SPEECH_LANG=en\n")), undefined);
		assert.equal(fileChoice(join(tmpdir(), "no-such-pi-speech.env")), undefined);
	});
});

describe("the telegram key lives in the same file, with its own rule", () => {
	it("reads absent as on: no key must never mute the bridge", () => {
		assert.equal(telegramChoice(tempEnv("PI_SPEECH_TUI=1\n")), undefined, "absent is not off");
		assert.equal(telegramChoice(tempEnv("PI_SPEECH_TELEGRAM=0\n")), false);
		assert.equal(telegramChoice(tempEnv("PI_SPEECH_TELEGRAM=1\n")), true);
	});

	it("writes one key without touching the other", () => {
		const file = tempEnv("PI_SPEECH_TUI=1\nPI_SPEECH_TELEGRAM=1\n");
		assert.equal(persistTelegram(false, file), undefined);
		assert.equal(readFileSync(file, "utf8"), "PI_SPEECH_TUI=1\nPI_SPEECH_TELEGRAM=0\n");
		assert.equal(fileChoice(file), true);
		assert.equal(telegramChoice(file), false);
	});

	it("reports the file's mtime so a newer write can win", () => {
		const file = tempEnv("PI_SPEECH_TUI=1\n");
		const before = speechEnvMtime(file);
		assert.ok(before > 0);
		assert.equal(persist(false, file), undefined);
		assert.ok(speechEnvMtime(file) >= before);
		assert.equal(speechEnvMtime(join(tmpdir(), "no-such-env-file")), 0);
	});
});
