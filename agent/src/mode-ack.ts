// Marks the replacement text a mode request produces, so the input hooks that follow it
// leave it alone: the phrase appenders must not add their lines to a machine instruction,
// and the JEV classifier must not spend a classifier call on it.
//
// pi loads each extension with its own module cache, so a module-level variable would not
// be shared. The marker lives on globalThis under a registered symbol, the same way
// src/jev-classify.ts shares one classification between the decision-node hooks.

const KEY = Symbol.for("cos-orchestrator-agent.mode-ack");

interface Marker {
  text: string | null;
}

function state(): Marker {
  const holder = globalThis as unknown as Record<symbol, Marker | undefined>;
  holder[KEY] ??= { text: null };
  return holder[KEY];
}

/** Remember the replacement just produced, so the hooks that follow can leave it alone. */
export function markModeAck(text: string): void {
  state().text = text.trim();
}

/** True when `text` is the replacement this process just produced for a mode request. */
export function isModeAck(text: string): boolean {
  const marked = state().text;
  return marked !== null && marked === text.trim();
}

/** Forget the marker. Tests only; the next mode request sets it again. */
export function resetModeAck(): void {
  state().text = null;
}
