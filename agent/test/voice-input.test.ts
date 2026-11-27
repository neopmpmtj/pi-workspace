import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVoiceInput, markVoiceInput, stripVoiceMarker, VOICE_MARKER } from "../src/voice-input.ts";

describe("voice input marker", () => {
	it("marks a transcript so the routing hooks can recognise it", () => {
		const marked = markVoiceInput("what time is it");
		assert.equal(marked, `${VOICE_MARKER}what time is it`);
		assert.equal(isVoiceInput(marked), true);
	});

	it("never mistakes typed text for a voice prompt", () => {
		assert.equal(isVoiceInput("what time is it"), false);
		assert.equal(isVoiceInput(""), false);
	});

	it("strips only the marker", () => {
		assert.equal(stripVoiceMarker(markVoiceInput("Pamela off")), "Pamela off");
		assert.equal(stripVoiceMarker("typed text"), "typed text");
	});

	it("survives trim(), which the hooks call before classifying", () => {
		const marked = markVoiceInput("remind me to buy milk");
		assert.equal(marked.trim(), marked, "the marker is not whitespace");
		assert.equal(stripVoiceMarker(marked.trim()).trim(), "remind me to buy milk");
	});
});
