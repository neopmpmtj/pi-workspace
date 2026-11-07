// Terminal entry to the project control plane: the same values the dashboard's
// /settings page edits. Every write goes through store.ts, so validation and the
// atomic file replacement match the web page, and no server or port is needed.
//
// Usage: pi-config <list|get|set> ... (see USAGE below, or `pi-config help`).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PI_ROOT } from "./agents.ts";
import {
  planeProblem,
  readControlPlane,
  SettingsError,
  writeAgentSettings,
  writeGate,
  writeInputPhrase,
  writePromptBuild,
  type ControlPlane,
  type ExtensionView,
  type FieldView,
  type InputPhraseView,
  type PackageView,
  type PromptBuildView,
} from "./store.ts";

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

const stdio: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

const USAGE = `pi-config — terminal control plane for ~/.pi. The same values as http://127.0.0.1:8786/settings.

  pi-config list [--json]                  every gate, inputPhrase, promptBuild and agent setting
  pi-config get <path> [--json]            one value; objects print as JSON
  pi-config set <path> <value...>          write one value through the dashboard's own validation
  pi-config use <section>.<option>         switch an option group in one write (the others go off)
  pi-config help                           this text

Flags: --json (machine output) · --dry-run (print the payload, write nothing) · --root <dir> (another ~/.pi tree)
Two deadlines: PI_CONFIG_TIMEOUT_MS (one file read/write, default 5000) and
PI_CONFIG_WATCHDOG_MS (a whole command, default 15000).

Paths
  <gate>.<field>                 config.json gates: lessThanInputWords{enabled,words,print},
                                 inputContainsPath/Url/Email{enabled,print},
                                 calendarNode{enabled,print,mode} (mode: route|dry),
                                 reminderNode{enabled,print,mode,writes}
  inputPhrase.enabled            input-phrase-config.json
  inputPhrase.append1
  inputPhrase.<normal|advanced>.{enabled,allowBlank,phrase}
  promptBuild.enabled            prompt-build-config.json
  promptBuild.<1-Personal|2-Development|3-Work|4-Automatic>.{enabled,prompt,config}
                                 config takes a JSON object
  agent.<id>.{provider,model,thinking,tools,enabledModels,extensions,packages}
                                 <id>: cos · image-describer · web-master · keep · google-workspace
                                 tools/enabledModels take a comma list, extensions/packages a JSON array

Booleans accept true/false, on/off, yes/no, 1/0. A value with spaces is joined from the
remaining words, so quoting is optional: pi-config set promptBuild.2-Development.prompt be kind

inputPhrase and promptBuild need exactly one option on while they are enabled, so switching
between options is one 'use' write, not two 'set' writes that each fail in between.

Examples
  pi-config set inputPhrase.enabled off
  pi-config use inputPhrase.normal
  pi-config use promptBuild 3-Work
  pi-config set inputPhrase.normal.phrase "answer in one sentence"
  pi-config set promptBuild.2-Development.enabled on
  pi-config set calendarNode.mode dry
  pi-config set reminderNode.writes off
  pi-config set lessThanInputWords.words 12
  pi-config set agent.cos.thinking high
  pi-config set agent.cos.tools "read,bash,grep,find"
  pi-config get agent.cos.model`;

/** Runs one command. Returns the process exit code: 0 written or read, 1 rejected. */
export async function main(argv: readonly string[], io: Io = stdio): Promise<number> {
  let json = false;
  let dryRun = false;
  let root = PI_ROOT;
  const words: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") json = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--root") {
      const next = argv[index + 1];
      index += 1;
      if (!next) {
        io.err("[FAIL] --root needs a directory.");
        return 1;
      }
      root = path.resolve(next);
    } else if (arg.startsWith("--root=")) root = path.resolve(arg.slice("--root=".length));
    else words.push(arg);
  }

  const [command, ...rest] = words;
  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      io.out(USAGE);
      return 0;
    }
    if (command === "list" || command === "ls" || command === "show") {
      if (rest.length > 0) throw new SettingsError("list takes no path.");
      const plane = await readControlPlane(root);
      io.out(json ? JSON.stringify(plane, null, 2) : formatPlane(plane));
      // Skipped and repaired files are reported, but `list` still exits 0 with what it read.
      for (const message of plane.seeded) io.err(`[note] ${message}`);
      for (const problem of plane.problems) io.err(`[note] ${problem.file}: ${problem.message}`);
      if (plane.problems.length > 0) {
        io.err(`[note] ${plane.problems.length} file(s) could not be read — the rest is shown above.`);
      }
      return 0;
    }
    if (command === "get") {
      const dotted = rest[0];
      if (!dotted || rest.length > 1) throw new SettingsError("get needs exactly one path.");
      const plane = await readControlPlane(root);
      const value = readValue(plane, dotted);
      io.out(json ? JSON.stringify(value, null, 2) : format(value));
      return 0;
    }
    if (command === "use") {
      const section = rest[0];
      const option = rest.length === 2 ? rest[1] : rest.length === 1 ? rest[0].split(".")[1] ?? "" : "";
      const name = rest.length === 2 ? section : section.split(".")[0] ?? "";
      if (!name || !option || rest.length > 2) {
        throw new SettingsError("use needs <section>.<option>, for example inputPhrase.normal or promptBuild 3-Work.");
      }
      await useOption(root, name, option, dryRun);
      io.out(`${dryRun ? "[dry-run] " : ""}${name}.${option} is the one option on`);
      return 0;
    }
    if (command === "set") {
      const dotted = rest[0];
      const raw = rest.slice(1).join(" ");
      if (!dotted || rest.length < 2) throw new SettingsError("set needs a path and a value.");
      const result = await setValue(root, dotted, raw, dryRun);
      const head = dryRun ? "[dry-run] " : "";
      io.out(`${head}${dotted} = ${json ? JSON.stringify(result.value) : format(result.value)}`);
      if (dryRun) io.out(`${head}payload ${JSON.stringify(result.payload)}`);
      return 0;
    }
    throw new SettingsError(`Unknown command ${command}. Try: pi-config help`);
  } catch (error) {
    let message = error instanceof Error ? error.message : "Command failed.";
    if (/exactly one option/.test(message)) {
      message += " Switch with: pi-config use <section>.<option>. Or turn the section off first.";
    }
    io.err(`[FAIL] ${message}`);
    return 1;
  }
}

/** The new value, and the payload that produced it, for one set. */
export interface SetResult {
  value: unknown;
  payload: unknown;
}

/** Applies one dotted set. Writes only when dryRun is false; the store validates either way. */
export async function setValue(root: string, dotted: string, raw: string, dryRun = false): Promise<SetResult> {
  const plane = await readControlPlane(root);
  const parts = dotted.split(".").filter((part) => part.length > 0);
  if (parts[0] === "gates") parts.shift();
  if (parts.length === 0) throw new SettingsError("set needs a path.");
  assertReadable(plane, parts[0]);

  const gate = plane.gates.find((candidate) => candidate.name === parts[0]);
  if (gate) return setGate(root, gate, parts, raw, dryRun);
  if (parts[0] === "inputPhrase") return setInputPhrase(root, inputPhraseOf(plane), parts, raw, dryRun);
  if (parts[0] === "promptBuild") return setPromptBuild(root, promptBuildOf(plane), parts, raw, dryRun);
  if (parts[0] === "agent") return setAgent(root, plane, parts, raw, dryRun);
  throw new SettingsError(`No gate or section named ${parts[0]}.`);
}

async function setGate(root: string, gate: GateViewOf, parts: string[], raw: string, dryRun: boolean): Promise<SetResult> {
  const field = parts[1];
  if (!field || parts.length !== 2) throw new SettingsError(`Use <gate>.<field>, for example ${gate.name}.enabled.`);
  const current = gate.fields.find((candidate) => candidate.key === field);
  if (!current) {
    const known = gate.fields.map((candidate) => candidate.key).join(", ");
    throw new SettingsError(`${gate.name} has no field ${field}. Fields: ${known}.`);
  }
  const value = parseForField(current, raw, `${gate.name}.${field}`);
  const payload = { fields: { [field]: value } };
  if (!dryRun) await writeGate(gate.name, payload, root);
  return { value, payload };
}

async function setInputPhrase(root: string, view: InputPhraseViewOf, parts: string[], raw: string, dryRun: boolean): Promise<SetResult> {
  const body = {
    enabled: view.enabled,
    append1: view.append1,
    options: view.options.map((option) => ({ ...option })),
  };
  let value: unknown;
  if (parts.length === 2 && (parts[1] === "enabled" || parts[1] === "append1")) {
    value = parts[1] === "enabled" ? parseBool(raw, "inputPhrase.enabled") : raw;
    if (parts[1] === "enabled") body.enabled = value as boolean;
    else body.append1 = value as string;
  } else if (parts.length === 3) {
    const option = body.options.find((candidate) => candidate.name === parts[1]);
    if (!option) throw new SettingsError(`inputPhrase has no option ${parts[1]}. Options: normal, advanced.`);
    const field = parts[2];
    if (field === "enabled") {
      option.enabled = parseBool(raw, `inputPhrase.${option.name}.enabled`);
      value = option.enabled;
    } else if (field === "allowBlank") {
      option.allowBlank = parseBool(raw, `inputPhrase.${option.name}.allowBlank`);
      value = option.allowBlank;
    } else if (field === "phrase") {
      option.phrase = raw;
      value = option.phrase;
    } else throw new SettingsError(`inputPhrase.${option.name} has no field ${field}.`);
  } else {
    throw new SettingsError("Use inputPhrase.enabled, inputPhrase.append1 or inputPhrase.<normal|advanced>.<field>.");
  }
  if (!dryRun) await writeInputPhrase(body, root);
  return { value, payload: body };
}

async function setPromptBuild(root: string, view: PromptBuildViewOf, parts: string[], raw: string, dryRun: boolean): Promise<SetResult> {
  const body = {
    enabled: view.enabled,
    options: view.options.map((option) => ({ ...option })),
  };
  let value: unknown;
  if (parts.length === 2 && parts[1] === "enabled") {
    body.enabled = parseBool(raw, "promptBuild.enabled");
    value = body.enabled;
  } else if (parts.length === 3) {
    const option = body.options.find((candidate) => candidate.name === parts[1]);
    if (!option) {
      const known = body.options.map((candidate) => candidate.name).join(", ");
      throw new SettingsError(`promptBuild has no option ${parts[1]}. Options: ${known}.`);
    }
    const field = parts[2];
    if (field === "enabled") {
      option.enabled = parseBool(raw, `promptBuild.${option.name}.enabled`);
      value = option.enabled;
    } else if (field === "prompt") {
      option.prompt = raw;
      value = option.prompt;
    } else if (field === "config") {
      const parsed = parseObject(raw, `promptBuild.${option.name}.config`);
      option.config = JSON.stringify(parsed, null, 2);
      value = parsed;
    } else throw new SettingsError(`promptBuild.${option.name} has no field ${field}.`);
  } else {
    throw new SettingsError("Use promptBuild.enabled or promptBuild.<option>.{enabled,prompt,config}.");
  }
  if (!dryRun) await writePromptBuild(body, root);
  return { value, payload: body };
}

async function setAgent(root: string, plane: ControlPlaneOf, parts: string[], raw: string, dryRun: boolean): Promise<SetResult> {
  const id = parts[1];
  const field = parts[2];
  if (!id || !field || parts.length !== 3) {
    throw new SettingsError("Use agent.<id>.<field>, for example agent.cos.thinking high.");
  }
  const view = plane.agents.find((candidate) => candidate.id === id);
  if (!view) {
    const known = plane.agents.map((candidate) => candidate.id).join(", ");
    throw new SettingsError(`No agent ${id}. Agents: ${known}.`);
  }
  if (!view.readable) throw new SettingsError(`agent.${id}: ${view.error ?? "settings.json is unreadable."}`);
  const body = {
    provider: view.provider,
    model: view.model,
    thinking: view.thinking,
    tools: [...view.tools],
    enabledModels: view.enabledModels,
    extensions: view.extensions,
    packages: view.packages,
  };
  let value: unknown;
  if (field === "provider" || field === "model") {
    const text = raw.trim();
    if (text === "") throw new SettingsError(`agent.${id}.${field} cannot be empty.`);
    if (/\s/.test(text)) throw new SettingsError(`agent.${id}.${field} cannot contain whitespace.`);
    if (field === "provider") body.provider = text;
    else body.model = text;
    value = text;
  } else if (field === "thinking") {
    body.thinking = raw.trim();
    value = body.thinking;
  } else if (field === "tools") {
    body.tools = parseList(raw);
    value = body.tools;
  } else if (field === "enabledModels") {
    body.enabledModels = parseList(raw);
    value = body.enabledModels;
  } else if (field === "extensions") {
    body.extensions = parseExtensions(raw, `agent.${id}.extensions`);
    value = body.extensions;
  } else if (field === "packages") {
    body.packages = parsePackages(raw, `agent.${id}.packages`);
    value = body.packages;
  } else {
    throw new SettingsError(
      `agent.${id} has no field ${field}. Fields: provider, model, thinking, tools, enabledModels, extensions, packages.`,
    );
  }
  if (!dryRun) await writeAgentSettings(id, body, root);
  return { value, payload: body };
}

/** Turns one option on and every other option of that group off, in a single write. */
export async function useOption(root: string, section: string, option: string, dryRun = false): Promise<unknown> {
  const plane = await readControlPlane(root);

  if (section === "inputPhrase") {
    const view = inputPhraseOf(plane);
    if (!view.options.some((candidate) => candidate.name === option)) {
      throw new SettingsError(`inputPhrase has no option ${option}. Options: ${view.options.map((candidate) => candidate.name).join(", ")}.`);
    }
    const body = {
      enabled: view.enabled,
      append1: view.append1,
      options: view.options.map((candidate) => ({ ...candidate, enabled: candidate.name === option })),
    };
    if (!dryRun) await writeInputPhrase(body, root);
    return body;
  }

  if (section === "promptBuild") {
    const view = promptBuildOf(plane);
    if (!view.options.some((candidate) => candidate.name === option)) {
      throw new SettingsError(`promptBuild has no option ${option}. Options: ${view.options.map((candidate) => candidate.name).join(", ")}.`);
    }
    const body = {
      enabled: view.enabled,
      options: view.options.map((candidate) => ({ ...candidate, enabled: candidate.name === option })),
    };
    if (!dryRun) await writePromptBuild(body, root);
    return body;
  }

  throw new SettingsError(`No option group named ${section}. Groups: inputPhrase, promptBuild.`);
}

/** One value from the plane, by dotted path. Objects come back whole. */
export function readValue(plane: ControlPlaneOf, dotted: string): unknown {
  const parts = dotted.split(".").filter((part) => part.length > 0);
  if (parts[0] === "gates") {
    parts.shift();
    if (parts.length === 0) return plane.gates;
  }
  if (parts.length === 0) throw new SettingsError("get needs a path.");
  assertReadable(plane, parts[0]);

  const gate = plane.gates.find((candidate) => candidate.name === parts[0]);
  if (gate) {
    if (parts.length === 1) return gate;
    if (parts.length !== 2) throw new SettingsError(`${gate.name} has one field level, for example ${gate.name}.enabled.`);
    const field = gate.fields.find((candidate) => candidate.key === parts[1]);
    if (!field) {
      const known = gate.fields.map((candidate) => candidate.key).join(", ");
      throw new SettingsError(`${gate.name} has no field ${parts[1]}. Fields: ${known}.`);
    }
    return field.value;
  }

  // `agents` lists every agent; `agents.<id>` and `agent.<id>` both address one.
  if (parts[0] === "agents") {
    parts.shift();
    if (parts.length === 0) return plane.agents;
    parts.unshift("agent");
  }
  if (parts[0] === "agent") {
    const id = parts[1];
    if (!id) return plane.agents;
    const view = plane.agents.find((candidate) => candidate.id === id);
    if (!view) throw new SettingsError(`No agent ${id}.`);
    if (!view.readable) throw new SettingsError(`agent.${id}: ${view.error ?? "settings.json is unreadable."}`);
    if (parts.length === 2) return view;
    const value = (view as unknown as Record<string, unknown>)[parts[2]];
    if (value === undefined) throw new SettingsError(`agent.${id} has no field ${parts[2]}.`);
    return value;
  }

  if (parts[0] === "inputPhrase") {
    const view = inputPhraseOf(plane);
    if (parts.length === 1) return view;
    if (parts.length === 2) {
      if (parts[1] === "enabled" || parts[1] === "append1") return view[parts[1]];
      const option = view.options.find((candidate) => candidate.name === parts[1]);
      if (!option) throw new SettingsError(`inputPhrase has no option ${parts[1]}.`);
      return option;
    }
    if (parts.length === 3) {
      const option = view.options.find((candidate) => candidate.name === parts[1]);
      if (!option) throw new SettingsError(`inputPhrase has no option ${parts[1]}.`);
      const value = (option as unknown as Record<string, unknown>)[parts[2]];
      if (value === undefined) throw new SettingsError(`inputPhrase.${option.name} has no field ${parts[2]}.`);
      return value;
    }
    throw new SettingsError("inputPhrase paths are enabled, append1 or <normal|advanced>.<field>.");
  }

  if (parts[0] === "promptBuild") {
    const view = promptBuildOf(plane);
    if (parts.length === 1) return view;
    if (parts.length === 2 && parts[1] === "enabled") return view.enabled;
    const option = view.options.find((candidate) => candidate.name === parts[1]);
    if (!option) throw new SettingsError(`promptBuild has no option ${parts[1]}.`);
    if (parts.length === 2) return option;
    if (parts.length === 3) {
      const value = (option as unknown as Record<string, unknown>)[parts[2]];
      if (value === undefined) throw new SettingsError(`promptBuild.${option.name} has no field ${parts[2]}.`);
      if (parts[2] === "config") return JSON.parse(option.config) as unknown;
      return value;
    }
    throw new SettingsError("promptBuild paths are enabled or <option>.{enabled,prompt,config}.");
  }

  throw new SettingsError(`No gate or section named ${parts[0]}.`);
}

/** Human table for `pi-config list`. */
export function formatPlane(plane: ControlPlaneOf): string {
  const lines: string[] = ["gates (config.json)"];
  if (plane.problems.some((problem) => problem.file === "config.json")) {
    lines.push("  (unreadable — see the note on stderr)");
  }
  for (const gate of plane.gates) {
    const fields = gate.fields.map((field) => `${field.key}=${display(field.value)}`).join(" ");
    lines.push(`  ${gate.name.padEnd(20)} ${fields}`);
  }
  lines.push("", "inputPhrase (input-phrase-config.json)");
  if (plane.inputPhrase === null) {
    lines.push("  (unreadable — see the note on stderr)");
  } else {
    lines.push(`  enabled=${plane.inputPhrase.enabled} append1=${display(plane.inputPhrase.append1)}`);
    for (const option of plane.inputPhrase.options) {
      lines.push(`  ${option.name.padEnd(20)} enabled=${option.enabled} allowBlank=${option.allowBlank} phrase=${display(option.phrase)}`);
    }
  }
  lines.push("", "promptBuild (prompt-build-config.json)");
  if (plane.promptBuild === null) {
    lines.push("  (unreadable — see the note on stderr)");
  } else {
    lines.push(`  enabled=${plane.promptBuild.enabled}`);
    for (const option of plane.promptBuild.options) {
      lines.push(`  ${option.name.padEnd(20)} enabled=${option.enabled} prompt=${display(option.prompt)} config=${compact(option.config)}`);
    }
  }
  lines.push("", "agents");
  for (const agent of plane.agents) {
    if (!agent.readable) {
      lines.push(`  ${agent.id.padEnd(20)} (unreadable: ${agent.error ?? "settings.json"})`);
      continue;
    }
    const port = agent.port === null ? "-" : `:${agent.port}`;
    const models = agent.provider === "" && agent.model === "" ? "-" : `${agent.provider}/${agent.model}`;
    const counts = [
      `${agent.tools.length} tools`,
      agent.extensions === null ? "extensions unset" : `${agent.extensions.length} extensions`,
      agent.packages === null ? "packages unset" : `${agent.packages.length} packages`,
    ].join(" · ");
    lines.push(`  ${agent.id.padEnd(20)} ${port.padEnd(6)} ${models} thinking=${agent.thinking} ${counts}`);
  }
  if (plane.problems.length > 0) {
    lines.push("", "skipped files");
    for (const problem of plane.problems) lines.push(`  ${problem.file.padEnd(28)} ${problem.message}`);
  }
  return lines.join("\n");
}

/**
 * Throws the recorded problem when the file a path belongs to could not be read, so a `get`
 * or `set` says which file is broken instead of "no gate or section named ...".
 */
function assertReadable(plane: ControlPlaneOf, head: string): void {
  if (head === "inputPhrase") {
    if (plane.inputPhrase === null) throw unavailable("input-phrase-config.json", plane);
    return;
  }
  if (head === "promptBuild") {
    if (plane.promptBuild === null) throw unavailable("prompt-build-config.json", plane);
    return;
  }
  // An agent is checked by id (setAgent / readValue); only the gates live in config.json.
  if (head === "agent" || head === "agents") return;
  if (planeProblem(plane, "config.json")) throw unavailable("config.json", plane);
}

function unavailable(file: string, plane: ControlPlaneOf): SettingsError {
  const problem = planeProblem(plane, file);
  return new SettingsError(problem ? `${problem.file}: ${problem.message}` : `${file} is unavailable.`);
}

function inputPhraseOf(plane: ControlPlaneOf): InputPhraseViewOf {
  if (plane.inputPhrase === null) throw unavailable("input-phrase-config.json", plane);
  return plane.inputPhrase;
}

function promptBuildOf(plane: ControlPlaneOf): PromptBuildViewOf {
  if (plane.promptBuild === null) throw unavailable("prompt-build-config.json", plane);
  return plane.promptBuild;
}

function parseForField(field: FieldView, raw: string, label: string): unknown {
  if (field.type === "boolean") return parseBool(raw, label);
  if (field.type === "number") return parseNumber(raw, label);
  if (field.type === "mode") return raw.trim();
  return raw;
}

function parseBool(raw: string, label: string): boolean {
  const text = raw.trim().toLowerCase();
  if (text === "true" || text === "on" || text === "yes" || text === "1") return true;
  if (text === "false" || text === "off" || text === "no" || text === "0") return false;
  throw new SettingsError(`${label} must be true/false (or on/off).`);
}

function parseNumber(raw: string, label: string): number {
  const text = raw.trim();
  const value = Number(text);
  if (text === "" || !Number.isFinite(value)) throw new SettingsError(`${label} must be a number.`);
  return value;
}

function parseList(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseObject(raw: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new SettingsError(`${label} must be a JSON object.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SettingsError(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function parseExtensions(raw: string, label: string): ExtensionView[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new SettingsError(`${label} must be a JSON array, for example ["+extensions/chat/index.ts"].`);
  }
  if (!Array.isArray(parsed)) throw new SettingsError(`${label} must be a JSON array.`);
  return parsed.map((item) => {
    if (typeof item === "string") {
      const enabled = !item.startsWith("-") && !item.startsWith("!");
      return { path: item.replace(/^[+\-!]/, ""), enabled };
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new SettingsError(`${label} entries must be strings or {path, enabled}.`);
    const body = item as Record<string, unknown>;
    if (typeof body.path !== "string") throw new SettingsError(`${label} entries need a path.`);
    return { path: body.path.replace(/^[+\-!]/, ""), enabled: body.enabled === true };
  });
}

function parsePackages(raw: string, label: string): PackageView[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new SettingsError(`${label} must be a JSON array of package names or {kind, value}.`);
  }
  if (!Array.isArray(parsed)) throw new SettingsError(`${label} must be a JSON array.`);
  return parsed.map((item) => {
    if (typeof item === "string") return { kind: "name", value: item, extensions: [] };
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new SettingsError(`${label} entries must be strings or {kind, value}.`);
    const body = item as Record<string, unknown>;
    const kind = body.kind === "source" ? "source" : "name";
    if (typeof body.value !== "string") throw new SettingsError(`${label} entries need a value.`);
    const extensions = Array.isArray(body.extensions) ? parseExtensions(JSON.stringify(body.extensions), label) : [];
    return { kind, value: body.value, extensions };
  });
}

function display(value: unknown): string {
  if (typeof value === "string") return value === "" ? '""' : JSON.stringify(value);
  return String(value);
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function format(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return display(value);
  return JSON.stringify(value, null, 2);
}

// Structurally identical views, named locally so this file does not depend on how
// store.ts spells its exports.
type ControlPlaneOf = ControlPlane;
type GateViewOf = ControlPlane["gates"][number];
type InputPhraseViewOf = InputPhraseView;
type PromptBuildViewOf = PromptBuildView;

/**
 * The last-resort bound on one command. Per-operation deadlines (store.ts) cover a slow file
 * system, but a read blocked inside the kernel — a dead NFS/sshfs mount, an open FIFO — cannot
 * be aborted from JavaScript, only abandoned: even process.exit() waits for that request to
 * drain, so the watchdog signals itself. Writes go through a temp file and a rename, so the real
 * file is whole. Exit code is 137 (SIGKILL) by design.
 */
function watchdog(): NodeJS.Timeout {
  const raw = Number(process.env.PI_CONFIG_WATCHDOG_MS ?? "");
  const ms = Number.isFinite(raw) && raw >= 100 ? Math.floor(raw) : 15_000;
  const timer = setTimeout(() => {
    process.stderr.write(
      `[FAIL] no answer within ${ms} ms — the file system may be hung (exit 137). ` +
        `Nothing was left half-written; run again with PI_CONFIG_WATCHDOG_MS=<ms> to wait longer.\n`,
    );
    process.kill(process.pid, "SIGKILL");
  }, ms);
  timer.unref();
  return timer;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked !== "" && path.resolve(fileURLToPath(import.meta.url)) === invoked) {
  const timer = watchdog();
  // A last-resort guard: main already reports every expected failure as [FAIL].
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[FAIL] ${error instanceof Error ? error.message : "Command failed."}\n`);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
}
