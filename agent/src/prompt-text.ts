// The speaker's words, without the surface markup pi adds.
//
// Shared by the JEV classifier and the mode detector. It sits in its own module so the
// detector can be called from the classifier's path without an import cycle.

// Kept in step with clean() in decision-nodes/*/route.py.
const HARNESS_LINE = /^\s*\[(time|voice)\][^\n]*$/gim;
const HARNESS_INLINE = /^\s*\[(telegram|tui)\]\s*/gim;
const HARNESS_ANY = /\[(time|voice|telegram|tui)\][^\n]*/gi;

/** Strip the surface markup pi adds, so only the speaker's words are read. */
export function cleanPrompt(raw: string): string {
  const text = raw.replace(HARNESS_LINE, "").replace(HARNESS_INLINE, "").replace(HARNESS_ANY, " ");
  return text.split("\n").map((line) => line.trim()).filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
}
