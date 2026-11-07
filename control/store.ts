// Reads and writes the project control plane. A rejected value throws SettingsError
// before any file is replaced.
import { access, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { AGENTS, PI_ROOT, THINKING_LEVELS, agentById, agentDir, type AgentSpec } from "./agents.ts";

export class SettingsError extends Error {}

export interface FieldView {
  key: string;
  type: "boolean" | "number" | "string" | "mode";
  value: boolean | number | string;
}

export interface GateView {
  name: string;
  fields: FieldView[];
}

export interface PhraseOptionView {
  name: string;
  enabled: boolean;
  allowBlank: boolean;
  phrase: string;
}

export interface InputPhraseView {
  enabled: boolean;
  append1: string;
  options: PhraseOptionView[];
}

export interface PromptBuildOptionView {
  name: string;
  enabled: boolean;
  prompt: string;
  config: string;
}

export interface PromptBuildView {
  enabled: boolean;
  options: PromptBuildOptionView[];
}

export interface ExtensionView {
  path: string;
  enabled: boolean;
}

export interface PackageView {
  kind: "name" | "source";
  value: string;
  extensions: ExtensionView[];
}

export interface AgentSettingsView {
  id: string;
  name: string;
  port: number | null;
  modelSource: "default-model" | "settings";
  provider: string;
  model: string;
  thinking: string;
  tools: string[];
  enabledModels: string[] | null;
  extensions: ExtensionView[] | null;
  packages: PackageView[] | null;
}

export interface ControlPlane {
  gates: GateView[];
  inputPhrase: InputPhraseView;
  promptBuild: PromptBuildView;
  agents: AgentSettingsView[];
}

const OPTION_NAMES = ["normal", "advanced"] as const;
const PROMPT_BUILD_OPTIONS = ["personal", "option1", "option2", "option3", "option4"] as const;

export async function readControlPlane(root = PI_ROOT): Promise<ControlPlane> {
  const config = await readObject(path.join(root, "config.json"));
  const modes = await readObject(path.join(root, "agent-modes-config.json"));
  const promptBuild = await readObject(path.join(root, "prompt-build-config.json"));
  const gates = Object.keys(config).map((name) => gateView(name, config[name]));
  return {
    gates,
    inputPhrase: inputPhraseView(modes.inputPhrase),
    promptBuild: promptBuildView(promptBuild.promptBuild),
    agents: await Promise.all(AGENTS.map((agent) => readAgent(root, agent))),
  };
}

export async function writeGate(name: string, incoming: unknown, root = PI_ROOT): Promise<GateView> {
  const file = path.join(root, "config.json");
  const config = await readObject(file);
  const section = config[name];
  if (!section || typeof section !== "object" || Array.isArray(section)) {
    throw new SettingsError(`No gate named ${name}.`);
  }
  const record = section as Record<string, unknown>;
  const fields = fieldMap(incoming);
  const next: Record<string, unknown> = { ...record };
  for (const [key, value] of Object.entries(fields)) {
    if (!(key in record)) throw new SettingsError(`${name}.${key} is not a field of this gate.`);
    next[key] = coerceLike(key, record[key], value, name);
  }
  config[name] = next;
  await writeObject(file, config);
  return gateView(name, next);
}

export async function writeInputPhrase(incoming: unknown, root = PI_ROOT): Promise<InputPhraseView> {
  const file = path.join(root, "agent-modes-config.json");
  const modes = await readObject(file);
  const current = modes.inputPhrase;
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    throw new SettingsError("inputPhrase is missing.");
  }
  const body = objectOf(incoming, "inputPhrase");
  const enabled = boolOf(body.enabled, "inputPhrase.enabled");
  const append1 = stringOf(body.append1, "inputPhrase.append1", true);
  const options = optionsOf(body.options);
  const on = options.filter((option) => option.enabled);
  if (enabled && on.length !== 1) {
    throw new SettingsError("inputPhrase is on, so exactly one option must be on.");
  }
  const record: Record<string, unknown> = { ...(current as Record<string, unknown>), enabled, append1 };
  for (const option of options) {
    const previous = record[option.name];
    const base = previous && typeof previous === "object" && !Array.isArray(previous)
      ? { ...(previous as Record<string, unknown>) }
      : {};
    record[option.name] = { ...base, enabled: option.enabled, allowBlank: option.allowBlank, phrase: option.phrase };
  }
  modes.inputPhrase = record;
  await writeObject(file, modes);
  return inputPhraseView(record);
}

export async function writePromptBuild(incoming: unknown, root = PI_ROOT): Promise<PromptBuildView> {
  const file = path.join(root, "prompt-build-config.json");
  const saved = await readObject(file);
  const current = saved.promptBuild;
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    throw new SettingsError("promptBuild is missing.");
  }
  const body = objectOf(incoming, "promptBuild");
  const enabled = boolOf(body.enabled, "promptBuild.enabled");
  const options = promptBuildOptionsOf(body.options);
  const on = options.filter((option) => option.enabled);
  if (enabled && on.length !== 1) {
    throw new SettingsError("promptBuild is on, so exactly one option must be on.");
  }
  const record: Record<string, unknown> = { ...(current as Record<string, unknown>), enabled };
  for (const option of options) {
    const previous = record[option.name];
    const base = previous && typeof previous === "object" && !Array.isArray(previous)
      ? { ...(previous as Record<string, unknown>) }
      : {};
    record[option.name] = {
      ...base,
      enabled: option.enabled,
      prompt: option.prompt,
      config: configObjectOf(option.config, `${option.name}.config`),
    };
  }
  saved.promptBuild = record;
  await writeObject(file, saved);
  return promptBuildView(record);
}

export async function writeAgentSettings(id: string, incoming: unknown, root = PI_ROOT): Promise<AgentSettingsView> {
  const agent = agentById(id);
  if (!agent) throw new SettingsError(`No agent named ${id}.`);
  const home = agentDir(root, agent);
  const settingsFile = path.join(home, "settings.json");
  const settings = await readObject(settingsFile);
  const body = objectOf(incoming, id);
  const provider = tokenOf(body.provider, `${id}.provider`);
  const model = tokenOf(body.model, `${id}.model`);
  const thinking = thinkingOf(body.thinking);
  const tools = listOf(body.tools, `${id}.tools`);
  const enabledModels = nullableList(body.enabledModels, `${id}.enabledModels`);
  const extensions = nullableExtensions(body.extensions, `${id}.extensions`);
  const packages = nullablePackages(body.packages, `${id}.packages`);

  const modelFile = path.join(home, "default-model.json");
  const hasDefaultModel = await exists(modelFile);
  if (hasDefaultModel) {
    const current = await readObject(modelFile);
    await writeObject(modelFile, {
      ...current,
      provider,
      model,
      thinking,
      updatedAt: new Date().toISOString(),
    });
  } else {
    settings.defaultProvider = provider;
    settings.defaultModel = model;
    settings.defaultThinkingLevel = thinking;
  }
  settings.defaultTools = tools;
  if (enabledModels !== null) settings.enabledModels = enabledModels;
  if (extensions !== null) settings.extensions = extensions.map(extensionEntry);
  if (packages !== null) {
    const existing = Array.isArray(settings.packages) ? settings.packages : [];
    settings.packages = packages.map((item, index) => packageEntry(existing[index], item));
  }
  await writeObject(settingsFile, settings);
  return readAgent(root, agent);
}

async function readAgent(root: string, agent: AgentSpec): Promise<AgentSettingsView> {
  const home = agentDir(root, agent);
  const settings = await readObject(path.join(home, "settings.json"));
  const modelFile = path.join(home, "default-model.json");
  const saved = await exists(modelFile) ? await readObject(modelFile) : null;
  const source = saved ?? settings;
  const providerKey = saved ? "provider" : "defaultProvider";
  const modelKey = saved ? "model" : "defaultModel";
  const thinkingKey = saved ? "thinking" : "defaultThinkingLevel";
  return {
    id: agent.id,
    name: agent.name,
    port: agent.port,
    modelSource: saved ? "default-model" : "settings",
    provider: typeof source[providerKey] === "string" ? source[providerKey] : "",
    model: typeof source[modelKey] === "string" ? source[modelKey] : "",
    thinking: typeof source[thinkingKey] === "string" ? source[thinkingKey] : "",
    tools: stringList(settings.defaultTools),
    enabledModels: "enabledModels" in settings ? stringList(settings.enabledModels) : null,
    extensions: "extensions" in settings ? extensionList(settings.extensions) : null,
    packages: "packages" in settings ? packageList(settings.packages) : null,
  };
}

function gateView(name: string, section: unknown): GateView {
  const record = objectOf(section, name);
  const fields = Object.entries(record).filter(([, value]) => isPrimitive(value)).map(([key, value]) => fieldView(key, value));
  return { name, fields };
}

function fieldView(key: string, value: unknown): FieldView {
  if (key === "mode") return { key, type: "mode", value: typeof value === "string" ? value : "" };
  if (typeof value === "boolean") return { key, type: "boolean", value };
  if (typeof value === "number") return { key, type: "number", value };
  return { key, type: "string", value: typeof value === "string" ? value : "" };
}

function promptBuildView(section: unknown): PromptBuildView {
  const record = objectOf(section, "promptBuild");
  return {
    enabled: record.enabled === true,
    options: PROMPT_BUILD_OPTIONS.map((name) => {
      const option = record[name];
      const body = option && typeof option === "object" && !Array.isArray(option) ? option as Record<string, unknown> : {};
      const config = body.config && typeof body.config === "object" && !Array.isArray(body.config) ? body.config : {};
      return {
        name,
        enabled: body.enabled === true,
        prompt: typeof body.prompt === "string" ? body.prompt : "",
        config: JSON.stringify(config, null, 2),
      };
    }),
  };
}

function promptBuildOptionsOf(value: unknown): PromptBuildOptionView[] {
  if (!Array.isArray(value)) throw new SettingsError("promptBuild options must be a list.");
  const byName = new Map<string, PromptBuildOptionView>();
  for (const item of value) {
    const body = objectOf(item, "option");
    const name = stringOf(body.name, "option.name", false);
    if (!PROMPT_BUILD_OPTIONS.includes(name as (typeof PROMPT_BUILD_OPTIONS)[number])) {
      throw new SettingsError(`Unknown option ${name}.`);
    }
    byName.set(name, {
      name,
      enabled: boolOf(body.enabled, `${name}.enabled`),
      prompt: textOf(body.prompt, `${name}.prompt`),
      config: textOf(body.config, `${name}.config`),
    });
  }
  if (byName.size !== PROMPT_BUILD_OPTIONS.length) throw new SettingsError("personal and option1 through option4 are all required.");
  return PROMPT_BUILD_OPTIONS.map((name) => byName.get(name)!);
}

function configObjectOf(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new SettingsError(`${label} must be a JSON object.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SettingsError(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function textOf(value: unknown, label: string): string {
  if (typeof value !== "string") throw new SettingsError(`${label} must be a string.`);
  return value;
}

function inputPhraseView(section: unknown): InputPhraseView {
  const record = objectOf(section, "inputPhrase");
  return {
    enabled: record.enabled === true,
    append1: typeof record.append1 === "string" ? record.append1 : "",
    options: OPTION_NAMES.map((name) => {
      const option = record[name];
      const body = option && typeof option === "object" && !Array.isArray(option) ? option as Record<string, unknown> : {};
      return {
        name,
        enabled: body.enabled === true,
        allowBlank: body.allowBlank === true,
        phrase: typeof body.phrase === "string" ? body.phrase : "",
      };
    }),
  };
}

function coerceLike(key: string, current: unknown, value: unknown, gate: string): boolean | number | string {
  if (typeof current === "boolean") return boolOf(value, `${gate}.${key}`);
  if (typeof current === "number") {
    if (key === "words") return wordsOf(value);
    if (typeof value !== "number" || !Number.isFinite(value)) throw new SettingsError(`${gate}.${key} must be a number.`);
    return value;
  }
  if (key === "mode") return modeOf(value);
  if (typeof current === "string") return stringOf(value, `${gate}.${key}`, true);
  throw new SettingsError(`${gate}.${key} cannot be edited here.`);
}

function wordsOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new SettingsError("words must be an integer of 1 or more.");
  }
  return value;
}

function modeOf(value: unknown): string {
  if (value !== "route" && value !== "dry") throw new SettingsError("mode must be route or dry.");
  return value;
}

function optionsOf(value: unknown): PhraseOptionView[] {
  if (!Array.isArray(value)) throw new SettingsError("inputPhrase options must be a list.");
  const byName = new Map<string, PhraseOptionView>();
  for (const item of value) {
    const body = objectOf(item, "option");
    const name = stringOf(body.name, "option.name", false);
    if (!OPTION_NAMES.includes(name as (typeof OPTION_NAMES)[number])) {
      throw new SettingsError(`Unknown option ${name}.`);
    }
    byName.set(name, {
      name,
      enabled: boolOf(body.enabled, `${name}.enabled`),
      allowBlank: boolOf(body.allowBlank, `${name}.allowBlank`),
      phrase: stringOf(body.phrase, `${name}.phrase`, true),
    });
  }
  if (byName.size !== OPTION_NAMES.length) throw new SettingsError("normal and advanced are both required.");
  return OPTION_NAMES.map((name) => byName.get(name)!);
}

function thinkingOf(value: unknown): string {
  if (typeof value !== "string" || !THINKING_LEVELS.includes(value as (typeof THINKING_LEVELS)[number])) {
    throw new SettingsError(`thinking must be one of ${THINKING_LEVELS.join(", ")}.`);
  }
  return value;
}

function tokenOf(value: unknown, label: string): string {
  const text = stringOf(value, label, false);
  if (/\s/.test(text)) throw new SettingsError(`${label} cannot contain whitespace.`);
  return text;
}

function listOf(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new SettingsError(`${label} must be a list of strings.`);
  }
  return value.map((item) => tokenOf(item, label));
}

function nullableList(value: unknown, label: string): string[] | null {
  if (value === null) return null;
  return listOf(value, label);
}

function nullableExtensions(value: unknown, label: string): ExtensionView[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) throw new SettingsError(`${label} must be a list.`);
  const seen = new Set<string>();
  return value.map((item) => {
    const body = objectOf(item, label);
    const extPath = extensionPath(body.path);
    if (seen.has(extPath)) throw new SettingsError(`${label} lists ${extPath} twice.`);
    seen.add(extPath);
    return { path: extPath, enabled: boolOf(body.enabled, `${label}.enabled`) };
  });
}

function nullablePackages(value: unknown, label: string): PackageView[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) throw new SettingsError(`${label} must be a list.`);
  return value.map((item) => {
    const body = objectOf(item, label);
    const kind = body.kind === "source" ? "source" : body.kind === "name" ? "name" : null;
    if (!kind) throw new SettingsError(`${label} kind must be name or source.`);
    return {
      kind,
      value: tokenOf(body.value, `${label}.value`),
      extensions: kind === "source" ? nullableExtensions(body.extensions, `${label}.extensions`) ?? [] : [],
    };
  });
}

function extensionPath(value: unknown): string {
  const text = stringOf(value, "extension path", false).replace(/^[+-]/, "");
  if (text.startsWith("/") || text.split("/").includes("..")) {
    throw new SettingsError("extension path must stay inside the agent home.");
  }
  return text;
}

function extensionEntry(extension: ExtensionView): string {
  return `${extension.enabled ? "+" : "-"}${extension.path}`;
}

function packageEntry(previous: unknown, item: PackageView): string | Record<string, unknown> {
  if (item.kind === "name") return item.value;
  const base = previous && typeof previous === "object" && !Array.isArray(previous)
    ? { ...(previous as Record<string, unknown>) }
    : {};
  return { ...base, source: item.value, extensions: item.extensions.map(extensionEntry) };
}

function extensionList(value: unknown): ExtensionView[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((entry) => {
    const enabled = !entry.startsWith("-") && !entry.startsWith("!");
    const extPath = entry.replace(/^[+\-!]/, "");
    return { path: extPath, enabled };
  });
}

function packageList(value: unknown): PackageView[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return { kind: "name", value: item, extensions: [] };
    const body = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    return {
      kind: "source",
      value: typeof body.source === "string" ? body.source : "",
      extensions: extensionList(body.extensions),
    };
  });
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function fieldMap(value: unknown): Record<string, unknown> {
  const body = objectOf(value, "gate");
  if (!body.fields || typeof body.fields !== "object" || Array.isArray(body.fields)) {
    throw new SettingsError("gate fields must be an object.");
  }
  return body.fields as Record<string, unknown>;
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SettingsError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function boolOf(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new SettingsError(`${label} must be a boolean.`);
  return value;
}

function stringOf(value: unknown, label: string, allowEmpty: boolean): string {
  if (typeof value !== "string") throw new SettingsError(`${label} must be a string.`);
  if (/[\r\n]/.test(value)) throw new SettingsError(`${label} cannot contain a newline.`);
  if (!allowEmpty && value.trim() === "") throw new SettingsError(`${label} cannot be empty.`);
  return value;
}

function isPrimitive(value: unknown): boolean {
  return typeof value === "boolean" || typeof value === "number" || typeof value === "string";
}

async function readObject(file: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new SettingsError(`Cannot read ${path.basename(file)}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new SettingsError(`${path.basename(file)} is not valid JSON.`);
  }
  return objectOf(parsed, path.basename(file));
}

async function writeObject(file: string, value: Record<string, unknown>): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
