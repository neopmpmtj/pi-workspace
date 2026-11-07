// Lines appended to a user message when inputPhrase is enabled and exactly one option is on.
// The option names live here so a later alternative is added in one place.

/** Option entries in inputPhrase. Exactly one may be enabled while the section is on. */
export const inputPhraseOptions = ["normal", "advanced"] as const;

export type InputPhraseOption = (typeof inputPhraseOptions)[number];

/** What an enabled inputPhrase section contributes to the next user message. */
export interface InputPhrase {
  /** append1, then the one enabled option's phrase. A "" entry is a blank line that is still appended. */
  lines: string[];
  /** Set when the section is on and the number of enabled options is not one. */
  conflict: string | null;
}

/** False for extension-sent prompts and slash commands. Those inputs stay unchanged. */
export function inputPhraseApplies(text: string, source: string): boolean {
  if (source === "extension") return false;
  if (text.startsWith("/")) return false;
  return true;
}

/** User text with each phrase on its own following line. A blank entry stays a blank line. */
export function appendInputPhrase(text: string, lines: readonly string[]): string {
  if (lines.length === 0) return text;
  const body = lines.map((line) => line.trim());
  const base = text.replace(/\s+$/, "");
  if (!base) return body.join("\n");
  return `${base}\n${body.join("\n")}`;
}

/**
 * Lines to append, or a conflict, for a section that is already enabled.
 * Zero enabled options and more than one enabled option are both conflicts.
 * Only boolean true counts as enabled.
 * append1 is appended whenever it is a string, including "".
 * An option phrase that trims to "" is appended only when that option's allowBlank is boolean true.
 */
export function inputPhraseFromSection(record: Record<string, unknown>): InputPhrase {
  const enabled = inputPhraseOptions.filter((name) => optionEnabled(record[name]));
  if (enabled.length !== 1) return { lines: [], conflict: inputPhraseConflict(enabled) };
  const lines: string[] = [];
  if (typeof record.append1 === "string") lines.push(record.append1.trim());
  const phrase = optionPhrase(record[enabled[0]]);
  if (phrase !== null) lines.push(phrase);
  return { lines, conflict: null };
}

function inputPhraseConflict(enabled: readonly string[]): string {
  if (enabled.length === 0) return "inputPhrase: enabled but no option is enabled";
  return `inputPhrase: ${enabled.join(" and ")} are both enabled`;
}

function optionEnabled(entry: unknown): boolean {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  return (entry as Record<string, unknown>).enabled === true;
}

function optionPhrase(entry: unknown): string | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  if (typeof record.phrase !== "string") return null;
  const trimmed = record.phrase.trim();
  if (trimmed.length === 0 && record.allowBlank !== true) return null;
  return trimmed;
}
