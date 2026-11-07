// The selected prompt-build option becomes one section of the system prompt.
// The option names live here so a later alternative is added in one place.

/** Option entries in promptBuild. Exactly one may be enabled while the section is on. */
export const promptBuildOptions = ["1-Personal", "2-Development", "3-Work", "4-Automatic"] as const;

export type PromptBuildOption = (typeof promptBuildOptions)[number];

/** What an enabled promptBuild section contributes to the system prompt. */
export interface PromptBuild {
  /** Text for sections.prompt_build. Null when the selected option has nothing to say. */
  section: string | null;
  /** Set when the section is on and the number of enabled options is not one. */
  conflict: string | null;
}

/**
 * Section text, or a conflict, for a section that is already enabled.
 * Zero enabled options and more than one enabled option are both conflicts.
 * Only boolean true counts as enabled.
 * A prompt that is not a string is absent. A config that is not an object is {}.
 * A blank prompt together with {} contributes no section.
 */
export function promptBuildFromSection(record: Record<string, unknown>): PromptBuild {
  const enabled = promptBuildOptions.filter((name) => optionEnabled(record[name]));
  if (enabled.length !== 1) return { section: null, conflict: promptBuildConflict(enabled) };
  const name = enabled[0];
  const prompt = optionPrompt(record[name]);
  const config = optionConfig(record[name]);
  if (prompt.length === 0 && Object.keys(config).length === 0) return { section: null, conflict: null };
  return { section: renderPromptBuild(name, prompt, config), conflict: null };
}

function promptBuildConflict(enabled: readonly string[]): string {
  if (enabled.length === 0) return "promptBuild: enabled but no option is enabled";
  return `promptBuild: ${enabled.join(" and ")} are both enabled`;
}

function optionEnabled(entry: unknown): boolean {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  return (entry as Record<string, unknown>).enabled === true;
}

function optionPrompt(entry: unknown): string {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
  const prompt = (entry as Record<string, unknown>).prompt;
  if (typeof prompt !== "string") return "";
  return prompt.trim();
}

function optionConfig(entry: unknown): Record<string, unknown> {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return {};
  const config = (entry as Record<string, unknown>).config;
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  return config as Record<string, unknown>;
}

function renderPromptBuild(name: string, prompt: string, config: Record<string, unknown>): string {
  return `${name}\n${prompt}\n${JSON.stringify(config, null, 2)}`;
}
