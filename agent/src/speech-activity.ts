/**
 * Who is speaking right now, shared across extensions in this pi process.
 *
 * Extensions each get their own module instance, so this state lives on
 * `globalThis` under a registered symbol (the same reason src/jev-classify.ts
 * keeps its memo there). `speech-reply.ts` and `voice-reply.ts` bracket every
 * playback with `speechStarted()` / `speechFinished()`; the wakeword extension
 * listens and mutes the microphone while a voice plays, so the agent never
 * transcribes its own answer back into the voice loop.
 */

type Listener = (speaking: boolean) => void;

interface SpeechState {
	active: number;
	listeners: Set<Listener>;
}

const KEY = Symbol.for("pi.speech.activity");

function state(): SpeechState {
	const host = globalThis as unknown as Record<symbol, SpeechState | undefined>;
	let current = host[KEY];
	if (!current) {
		current = { active: 0, listeners: new Set() };
		host[KEY] = current;
	}
	return current;
}

function notify(): void {
	const speaking = state().active > 0;
	for (const listener of state().listeners) {
		try {
			listener(speaking);
		} catch {
			// A listener must never break playback.
		}
	}
}

export function speechStarted(): void {
	state().active += 1;
	notify();
}

export function speechFinished(): void {
	const current = state();
	current.active = Math.max(0, current.active - 1);
	notify();
}

export function isSpeechActive(): boolean {
	return state().active > 0;
}

/** Subscribes to speaking/stopped transitions. Returns the unsubscribe function. */
export function onSpeechChange(listener: Listener): () => void {
	const current = state();
	current.listeners.add(listener);
	return () => current.listeners.delete(listener);
}
