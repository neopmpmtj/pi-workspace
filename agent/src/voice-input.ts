/**
 * Marks a prompt that came from the wakeword microphone.
 *
 * `pi.sendUserMessage()` arrives with `event.source === "extension"`, and every
 * routing hook in this home skips extension-sent text. A voice prompt is not
 * machine chatter, though: it is the user speaking, and calendar/reminder/mode
 * routing must treat it exactly like typed input. The marker carries that fact
 * from the wakeword extension to those hooks, and is stripped before any text
 * reaches the model or a classifier.
 *
 * U+2063 (invisible separator) cannot be typed or spoken, so a real message can
 * never be mistaken for a voice one.
 *
 * The same technique is used by src/mode-ack.ts for the opposite direction.
 */

export const VOICE_MARKER = "\u2063voice\u2063";

export function markVoiceInput(text: string): string {
	return VOICE_MARKER + text;
}

export function isVoiceInput(text: string): boolean {
	return text.startsWith(VOICE_MARKER);
}

export function stripVoiceMarker(text: string): string {
	return text.startsWith(VOICE_MARKER) ? text.slice(VOICE_MARKER.length) : text;
}
