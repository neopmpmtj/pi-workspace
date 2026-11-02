// Publishes this agent: reads the slash commands and tools its extensions register and
// writes them into agent.json (`commands`, `tools`) and the generated block of
// docs/CALLING.md. The code is the source of truth; these two files follow it.
//
//   npm run publish:agent            write what changed
//   npm run publish:agent -- --check write nothing, exit 1 when a file is out of date
import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BEGIN = "<!-- BEGIN GENERATED: commands -->";
export const END = "<!-- END GENERATED: commands -->";

export interface PublishedCommand {
  name: string;
  description: string;
  help?: string;
}

export interface PublishedTool {
  name: string;
  description: string;
  parameters: { name: string; description: string }[];
}

export interface Publication {
  commands: PublishedCommand[];
  tools: PublishedTool[];
}

export interface FileResult {
  path: string;
  changed: boolean;
}

/** Imports every extension in settings.json and records what it registers. Handlers never run. */
export async function collect(home: string): Promise<Publication> {
  const settings = JSON.parse(await readFile(path.join(home, "settings.json"), "utf8")) as { extensions?: string[] };
  const commands: PublishedCommand[] = [];
  const tools: PublishedTool[] = [];
  for (const entry of settings.extensions ?? []) {
    if (entry.startsWith("-")) continue;
    const file = path.resolve(home, entry.replace(/^\+/, ""));
    // The query defeats the ESM cache, so a second run in one process sees edited code.
    const module = (await import(`${pathToFileURL(file).href}?publish=${Date.now()}`)) as {
      default?: (pi: unknown) => unknown;
      HELP?: Record<string, string>;
    };
    if (typeof module.default !== "function") throw new Error(`${entry} has no default export.`);
    const found: PublishedCommand[] = [];
    await module.default(stubPi(found, tools));
    for (const command of found) {
      const help = module.HELP?.[command.name.slice(1)];
      commands.push(help === undefined ? command : { ...command, help });
    }
  }
  return { commands, tools };
}

function stubPi(commands: PublishedCommand[], tools: PublishedTool[]): unknown {
  const api: Record<string, unknown> = {
    registerCommand(name: string, options: { description?: string }) {
      commands.push({ name: `/${name}`, description: oneLine(options.description ?? "") });
    },
    registerTool(tool: { name: string; description?: string; parameters?: { properties?: Record<string, { description?: string }> } }) {
      tools.push({
        name: tool.name,
        description: oneLine(tool.description ?? ""),
        parameters: Object.entries(tool.parameters?.properties ?? {}).map(([name, schema]) => ({
          name,
          description: oneLine(schema.description ?? ""),
        })),
      });
    },
  };
  return new Proxy(api, { get: (target, key) => target[String(key)] ?? (() => undefined) });
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function renderBlock(publication: Publication): string {
  const lines = [BEGIN, "<!-- Written by scripts/publish.ts. Change the extension code, then run npm run publish:agent. -->", "", "## Slash commands", ""];
  if (publication.commands.length === 0) lines.push("None.", "");
  for (const command of publication.commands) {
    lines.push(`### ${command.name}`, "", command.description || "(no description)", "");
    if (command.help) lines.push("```text", command.help, "```", "");
  }
  lines.push("## Tools (chat model only)", "");
  if (publication.tools.length === 0) lines.push("None.", "");
  for (const tool of publication.tools) {
    lines.push(`### ${tool.name}`, "", tool.description || "(no description)", "");
    for (const parameter of tool.parameters) lines.push(`- \`${parameter.name}\`: ${parameter.description || "(no description)"}`);
    if (tool.parameters.length > 0) lines.push("");
  }
  lines.push(END);
  return lines.join("\n");
}

/** Replaces the generated block, or appends it when the markers are missing. */
export function renderCalling(existing: string, publication: Publication): string {
  const block = renderBlock(publication);
  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END);
  if (start === -1 && end === -1) return `${existing.trimEnd()}\n\n${block}\n`;
  if (start === -1 || end === -1 || end < start) throw new Error(`CALLING.md has a broken ${BEGIN} / ${END} pair.`);
  return existing.slice(0, start) + block + existing.slice(end + END.length);
}

/** Sets `commands` and `tools`, keeping every other key and the key order. */
export function renderManifest(existing: string, publication: Publication): string {
  const manifest = JSON.parse(existing) as Record<string, unknown>;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("agent.json must be a JSON object.");
  manifest.commands = publication.commands.map(({ name, description }) => ({ name, description }));
  manifest.tools = publication.tools.map(({ name, description }) => ({ name, description }));
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Computes both files before writing either; writes only what changed. */
export async function publish(home: string, options: { check?: boolean } = {}): Promise<FileResult[]> {
  const manifestPath = path.join(home, "agent.json");
  const callingPath = path.join(home, "docs", "CALLING.md");
  if (!existsSync(manifestPath)) throw new Error(`Missing ${manifestPath}.`);
  const publication = await collect(home);
  const oldManifest = await readFile(manifestPath, "utf8");
  const oldCalling = existsSync(callingPath) ? await readFile(callingPath, "utf8") : "";
  const next = [
    { path: manifestPath, before: oldManifest, after: renderManifest(oldManifest, publication) },
    { path: callingPath, before: oldCalling, after: renderCalling(oldCalling, publication) },
  ];
  const results = next.map((file) => ({ path: file.path, changed: file.before !== file.after }));
  if (options.check) return results;
  for (const file of next) {
    if (file.before === file.after) continue;
    const temp = `${file.path}.publish-tmp`;
    await writeFile(temp, file.after);
    await rename(temp, file.path);
  }
  return results;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const home = path.resolve(args.find((arg) => !arg.startsWith("--")) ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
  try {
    const results = await publish(home, { check });
    let stale = false;
    for (const result of results) {
      const shown = path.relative(home, result.path);
      if (!result.changed) console.log(`[ok] unchanged ${shown}`);
      else if (check) {
        stale = true;
        console.error(`[FAIL] out of date ${shown}. Run npm run publish:agent.`);
      } else console.log(`[ok] updated ${shown}`);
    }
    if (stale) process.exitCode = 1;
  } catch (error) {
    console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
