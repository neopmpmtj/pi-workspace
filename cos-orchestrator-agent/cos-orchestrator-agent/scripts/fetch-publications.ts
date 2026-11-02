// Fetches what the sibling agents publish (`*/*/agent.json` under the grouped root) and
// rebuilds the Sibling agents table in APPEND_SYSTEM.md. Reads JSON only: no sibling code
// is imported and no sibling script is run. A stale publication is the sibling's to fix.
//
//   npm run fetch:publications            write when the table changed
//   npm run fetch:publications -- --check write nothing, exit 1 when the table is out of date
import { existsSync, readdirSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BEGIN = "<!-- BEGIN GENERATED: siblings -->";
export const END = "<!-- END GENERATED: siblings -->";

export interface SiblingPublication {
  home: string;
  name: string;
  launcher: string;
  defaultPrompt: string;
  call?: string;
  purpose?: string;
  latestRun?: string;
  contract?: string;
  commands: { name: string }[];
}

export interface FetchResult {
  path: string;
  changed: boolean;
  siblings: string[];
}

/** Every agent home two or three levels below `root`: `<group>/<home>` or `<group>/<repo>/<home>`. */
function candidateHomes(root: string): string[] {
  const found: string[] = [];
  for (const group of subdirs(root)) {
    for (const child of subdirs(group)) {
      found.push(child);
      // A repo root that holds the Pi home one level down: .env beside it, agent.json inside.
      if (!existsSync(path.join(child, "agent.json"))) found.push(...subdirs(child));
    }
  }
  return found;
}

/** Every agent.json under `root` except the one in `self`, validated, sorted by name. */
export async function readPublications(root: string, self: string): Promise<SiblingPublication[]> {
  const found: SiblingPublication[] = [];
  const problems: string[] = [];
  for (const home of candidateHomes(root)) {
    if (path.resolve(home) === path.resolve(self)) continue;
    const manifestPath = path.join(home, "agent.json");
    if (!existsSync(manifestPath)) continue;
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      problems.push(`${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const missing = ["name", "launcher", "defaultPrompt"].filter((key) => typeof manifest[key] !== "string" || !(manifest[key] as string).trim());
    if (!Array.isArray(manifest.commands)) missing.push("commands");
    if (missing.length > 0) {
      problems.push(`${manifestPath}: missing ${missing.join(", ")}`);
      continue;
    }
    found.push({
      home,
      name: manifest.name as string,
      launcher: manifest.launcher as string,
      defaultPrompt: manifest.defaultPrompt as string,
      call: optionalString(manifest.call),
      purpose: optionalString(manifest.purpose),
      latestRun: optionalString(manifest.latestRun),
      contract: optionalString(manifest.contract),
      commands: (manifest.commands as unknown[]).flatMap((command) =>
        command && typeof (command as { name?: unknown }).name === "string" ? [{ name: (command as { name: string }).name }] : [],
      ),
    });
  }
  if (problems.length > 0) throw new Error(problems.join("\n"));
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

function subdirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function tilde(absolute: string): string {
  const home = homedir();
  return absolute === home || absolute.startsWith(`${home}${path.sep}`) ? `~${absolute.slice(home.length)}` : absolute;
}

/** `front-and-center.md` in its home, when the path is inside the sibling's home; else the path itself. */
function inHome(value: string, home: string): string {
  const shownHome = tilde(home);
  for (const prefix of [`${shownHome}/`, `${home}/`]) {
    if (value.startsWith(prefix)) return `\`${value.slice(prefix.length)}\` in its home`;
  }
  return `\`${value}\``;
}

function cell(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

export function renderRow(sibling: SiblingPublication): string {
  const defaultCommand = sibling.defaultPrompt.trim().split(/\s+/)[0];
  const others = sibling.commands.map((command) => command.name).filter((name) => name !== defaultCommand);
  const does: string[] = [];
  if (sibling.purpose) does.push(sibling.purpose);
  if (others.length > 0) does.push(`Other commands: ${others.join(", ")}.`);
  if (sibling.latestRun) does.push(`Latest run: ${inHome(sibling.latestRun, sibling.home)}.`);
  does.push(`Contract: ${inHome(sibling.contract ?? `${tilde(sibling.home)}/docs/CALLING.md`, sibling.home)}.`);
  const call = `${sibling.launcher} -p "${sibling.call ?? sibling.defaultPrompt}"`;
  return `| ${cell(sibling.name)} | \`${tilde(sibling.home)}\` | \`${cell(call)}\` | ${cell(does.join(" "))} |`;
}

export function renderTable(siblings: SiblingPublication[]): string {
  return [BEGIN, "| Sibling | Home | Call | Does |", "| --- | --- | --- | --- |", ...siblings.map(renderRow), END].join("\n");
}

export function renderAppendSystem(existing: string, siblings: SiblingPublication[]): string {
  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END);
  if (start === -1 || end === -1 || end < start) throw new Error(`APPEND_SYSTEM.md needs one ${BEGIN} / ${END} pair.`);
  return existing.slice(0, start) + renderTable(siblings) + existing.slice(end + END.length);
}

/** Validates every publication before writing; writes APPEND_SYSTEM.md only when it changed. */
export async function fetchPublications(home: string, options: { root?: string; check?: boolean } = {}): Promise<FetchResult> {
  const root = options.root ?? path.resolve(home, "..", "..");
  const target = path.join(home, "APPEND_SYSTEM.md");
  const siblings = await readPublications(root, home);
  const before = await readFile(target, "utf8");
  const after = renderAppendSystem(before, siblings);
  const result = { path: target, changed: before !== after, siblings: siblings.map((sibling) => sibling.name) };
  if (options.check || !result.changed) return result;
  const temp = `${target}.fetch-tmp`;
  await writeFile(temp, after);
  await rename(temp, target);
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const home = path.resolve(args.find((arg) => !arg.startsWith("--")) ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
  try {
    const result = await fetchPublications(home, { check });
    const shown = path.relative(home, result.path);
    const names = result.siblings.join(", ") || "none";
    if (!result.changed) console.log(`[ok] unchanged ${shown} (siblings: ${names})`);
    else if (check) {
      console.error(`[FAIL] out of date ${shown} (siblings: ${names}). Run npm run fetch:publications.`);
      process.exitCode = 1;
    } else console.log(`[ok] updated ${shown} (siblings: ${names})`);
  } catch (error) {
    console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
