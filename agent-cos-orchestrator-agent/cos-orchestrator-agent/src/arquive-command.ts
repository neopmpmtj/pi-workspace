// Turns `/arquive` text into argv for archive_to_target_full_tree.py and runs that script.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

export const ARQUIVE_HELP = `/arquive <path>
/arquive --dry-run <path>
/arquive --undo
/arquive --target <dir> <path>

Moves <path> into the archive target from archive-to-target-full-tree.config.json.
One run is remembered. /arquive --undo puts only that run back.`;

const FLAGS_WITH_VALUE = new Set(["--target", "--list", "--config", "--source"]);
const FLAGS = new Set(["--undo", "--dry-run", "--help", "-h"]);

export type ArquiveParse = { help: true } | { error: string } | { argv: string[] };

export function splitShellArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n") {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (quote) throw new Error("unclosed quote");
  if (current) tokens.push(current);
  return tokens;
}

export function parseArquiveArgs(input: string): ArquiveParse {
  let tokens: string[];
  try {
    tokens = splitShellArgs(input.trim());
  } catch (error) {
    return { error: error instanceof Error ? error.message : "unclosed quote" };
  }
  if (tokens.length === 0 || tokens[0] === "--help" || tokens[0] === "-h") return { help: true };

  const argv: string[] = [];
  let source: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (FLAGS.has(token)) {
      if (token === "--help" || token === "-h") return { help: true };
      argv.push(token);
      continue;
    }
    if (FLAGS_WITH_VALUE.has(token)) {
      const value = tokens[++i];
      if (!value) return { error: `${token} needs a value` };
      if (token === "--source") {
        if (source) return { error: "one source path" };
        source = value;
      } else {
        argv.push(token, value);
      }
      continue;
    }
    if (token.startsWith("-")) return { error: `unknown flag ${token}` };
    if (source) return { error: "one source path" };
    source = token;
  }

  const undo = argv.includes("--undo");
  const list = argv.includes("--list");
  if (undo && (source || list)) return { error: "--undo cannot be combined with a source path" };
  if (!undo && !list && !source) return { error: "missing source path" };
  if (source) argv.push("--source", source);
  return { argv };
}

export function arquiveScriptPath(home = homedir()): string {
  return path.join(
    home,
    ".pi",
    "apps-scripts",
    "archive-to-target-full-tree",
    "archive-to-target-full-tree",
    "archive_to_target_full_tree.py",
  );
}

export function runArquive(
  argv: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [arquiveScriptPath(), ...argv], { cwd, signal });
    let output = "";
    const take = (chunk: Buffer | string) => {
      output += chunk.toString();
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, output: output.trimEnd() });
    });
  });
}
