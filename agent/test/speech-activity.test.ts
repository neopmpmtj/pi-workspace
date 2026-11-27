import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSpeechActive, onSpeechChange, speechFinished, speechStarted } from "../src/speech-activity.ts";

describe("speech activity", () => {
	it("counts overlapping playbacks and only stops when the last one ends", () => {
		assert.equal(isSpeechActive(), false);

		speechStarted();
		speechStarted();
		assert.equal(isSpeechActive(), true);

		speechFinished();
		assert.equal(isSpeechActive(), true, "one answer is still playing");

		speechFinished();
		assert.equal(isSpeechActive(), false);
	});

	it("notifies every transition to a subscriber", () => {
		const seen: boolean[] = [];
		const off = onSpeechChange((speaking) => seen.push(speaking));

		speechStarted();
		speechFinished();
		off();

		speechStarted();
		speechFinished();

		assert.deepEqual(seen, [true, false]);
	});

	it("ignores an unbalanced finish instead of going negative", () => {
		speechFinished();
		assert.equal(isSpeechActive(), false);
	});
});
