// Guards /archive against moving files the agent cannot work without.
//
// The list lives in ~/.pi/scripts/protected-paths.txt (one pattern per line) so a human
// can edit it without touching TypeScript. This module only answers one question:
// "would this archive source touch a protected path, or a directory containing one?"
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const PROTECTED_LIST = ".pi/scripts/protected-paths.txt";
export const PROTECTED_DOC = "~/.pi/agent/docs/runbooks/what-must-remain.md";

export type ProtectedHit = { pattern: string; matched: string };

/** Absolute path of the list file for a given home. */
export function protectedListPath(home = homedir()): string {
  return path.join(home, ...PROTECTED_LIST.split("/"));
}

/** Patterns from the list, comments and blanks dropped. Missing file means no patterns. */
export function loadProtectedPatterns(file = protectedListPath()): string[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function expand(pattern: string, home: string): string {
  if (pattern === "~") return home;
  if (pattern.startsWith("~/")) return path.join(home, pattern.slice(2));
  if (path.isAbsolute(pattern)) return path.normalize(pattern);
  return path.join(home, pattern);
}

function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if ("\\^$.|?+()[]{}".includes(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return new RegExp(`${out}$`);
}

/** Directory that holds everything the glob can match — used to catch "moving the parent". */
function staticPrefixDir(glob: string): string {
  const idx = glob.search(/[*?[]/);
  const head = idx === -1 ? glob : glob.slice(0, idx);
  const cut = head.lastIndexOf("/");
  return cut <= 0 ? path.sep : head.slice(0, cut);
}

/**
 * Does archiving `source` (as typed, relative to `cwd`) touch a protected path?
 * Returns the offending pattern, or null when the move is allowed.
 */
export function protectedHitFor(
  source: string,
  cwd: string,
  patterns: string[] = loadProtectedPatterns(),
  home = homedir(),
): ProtectedHit | null {
  const target = path.resolve(cwd, expand(source, home));
  const targetAsDir = target.endsWith("/") ? target.slice(0, -1) : target;

  for (const pattern of patterns) {
    const absolute = expand(pattern, home);
    const hasWildcard = /[*?[]/.test(pattern);

    if (!hasWildcard) {
      // exact path, or the source is one of its parent directories
      if (target === absolute || absolute.startsWith(`${targetAsDir}/`)) {
        return { pattern, matched: absolute };
      }
      continue;
    }

    if (globToRegExp(absolute).test(target)) return { pattern, matched: target };

    // Moving a directory that CONTAINS protected matches (e.g. .pi/agent)
    const prefixDir = staticPrefixDir(absolute);
    if (prefixDir && prefixDir !== path.sep) {
      if (target === prefixDir || prefixDir.startsWith(`${targetAsDir}/`)) {
        return { pattern, matched: prefixDir };
      }
    }
  }
  return null;
}

/** True when the argv only reads (undo / list / dry-run) and may run unguarded. */
export function isReadOnlyArchive(argv: string[]): boolean {
  return argv.includes("--undo") || argv.includes("--list") || argv.includes("--dry-run");
}

/**
 * Refusal message for an argv, or null when the archive may proceed.
 * Kept separate from runArchive so it can be unit-tested without spawning python.
 */
export function archiveRefusal(
  argv: string[],
  cwd: string,
  patterns: string[] = loadProtectedPatterns(),
): string | null {
  if (isReadOnlyArchive(argv)) return null;
  const idx = argv.indexOf("--source");
  if (idx === -1) return null;
  const source = argv[idx + 1];
  if (!source) return null;

  const hit = protectedHitFor(source, cwd, patterns);
  if (!hit) return null;

  return [
    `[FAIL] /archive refuses to move ${source}`,
    `       it is protected by "${hit.pattern}" (matched ${hit.matched})`,
    `       these files keep the agent working — see ${PROTECTED_DOC}`,
    `       allowed: --dry-run, --list, --undo`,
  ].join("\n");
}
