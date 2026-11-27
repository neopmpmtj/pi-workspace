import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { startTriggerWatch } from "../src/wakeword-watch.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("startTriggerWatch", () => {
	let dir: string;
	let log: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "wakeword-watch-"));
		log = join(dir, "wakeword.log");
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("fires on new TRIGGER lines only", async () => {
		writeFileSync(log, "READY model=x\nTRIGGER 0.9 at=before-you-started\n");
		let hits = 0;
		const watch = startTriggerWatch(log, () => hits++, 20);

		await sleep(60);
		assert.equal(hits, 0, "history before startup must not fire");

		appendFileSync(log, "READY again\n");
		await sleep(60);
		assert.equal(hits, 0);

		appendFileSync(log, "TRIGGER 0.731 at=2026-11-27T18:39:10\n");
		await sleep(60);
		assert.equal(hits, 1);
		watch.stop();
	});

	it("holds a half-written line until its newline arrives", async () => {
		writeFileSync(log, "");
		let hits = 0;
		const watch = startTriggerWatch(log, () => hits++, 20);

		appendFileSync(log, "TRIGGER 0.7");
		await sleep(60);
		assert.equal(hits, 0, "no newline yet, so no trigger");

		appendFileSync(log, "01 at=now\n");
		await sleep(60);
		assert.equal(hits, 1);
		watch.stop();
	});

	it("resets the offset when the log is truncated", async () => {
		writeFileSync(log, "TRIGGER 0.8 at=one\n");
		let hits = 0;
		const watch = startTriggerWatch(log, () => hits++, 20);

		appendFileSync(log, "TRIGGER 0.8 at=two\n");
		await sleep(60);
		assert.equal(hits, 1);

		writeFileSync(log, "TRIGGER 0.8 at=after-rotation\n");
		await sleep(60);
		assert.equal(hits, 2);
		watch.stop();
	});

	it("stops firing after stop()", async () => {
		writeFileSync(log, "");
		let hits = 0;
		const watch = startTriggerWatch(log, () => hits++, 20);
		watch.stop();

		appendFileSync(log, "TRIGGER 0.8 at=late\n");
		await sleep(60);
		assert.equal(hits, 0);
	});
});
