// Canned `gog` commands: the fast path for requests made often.
//
// A chat turn costs seconds and tokens: the model reads the task, chooses a
// command, then reads the output and writes an answer. A canned command skips
// the model entirely — it runs one fixed `gog` command, shapes the JSON, and
// prints it. No tokens, well under a second. The price is a fixed phrasing: it
// answers exactly one question and takes no rewriting.
import { spawn } from "node:child_process";

export const CANNED = ["gdrive-root", "inbox-new", "agenda", "from", "find"] as const;
export type CannedCommand = (typeof CANNED)[number];

export const CANNED_DESCRIPTION: Record<CannedCommand, string> = {
  "gdrive-root": "Root of Google Drive: name, folder|file, id, modified — one tab-separated row per item, 20 rows by default (--limit N). No model turn, no tokens.",
  "inbox-new": "Unread mail newer than N hours (default 24): date, from, subject, id, 20 rows by default (--limit N). No model turn, no tokens.",
  agenda: "Today's events on the primary calendar: start, end, summary, id — 20 rows by default (--limit N). No model turn, no tokens.",
  from: "Unread mail from one sender: date, from, subject, id — /from <sender> [--limit N], 20 rows by default. No sender, no search. No model turn, no tokens.",
  find: "Drive files whose name contains a term: name, folder|file, id, modified — /find <name> [--limit N], 20 rows by default. No model turn, no tokens.",
};

/** Rows printed before the trailing "held back" line appears. `--limit 0` means all. */
export const DEFAULT_LIMIT = 20;

export const GOG_HELP: Record<CannedCommand, string> = {
  "gdrive-root": [
    "/gdrive-root [--limit N]",
    "",
    "Lists what sits in the root of Google Drive, one tab-separated row per item:",
    "",
    "  <name>\t<folder|file>\t<id>\t<modifiedTime>",
    "",
    "--limit N   Rows to print, 0 or more. Default 20. 0 prints all.",
    "",
    "Runs `gog drive ls --json --results-only`, so there is no model turn and no tokens. When rows are held back, one trailing line says how many and how to see them. An empty result prints `nothing found`.",
  ].join("\n"),
  "inbox-new": [
    "/inbox-new [--hours N] [--limit N]",
    "",
    "Lists unread mail newer than N hours, one tab-separated row per message:",
    "",
    "  <date>\t<from>\t<subject>\t<id>",
    "",
    "--hours N   1 to 720. Default 24.",
    "--limit N   Rows to print, 0 or more. Default 20. 0 prints all.",
    "",
    "Runs `gog gmail search 'is:unread newer_than:Nh' --json --results-only`, so there is no model turn and no tokens. When rows are held back, one trailing line says how many and how to see them. An empty result prints `nothing found`.",
  ].join("\n"),
  agenda: [
    "/agenda [--limit N]",
    "",
    "Lists today's events on the primary calendar, one tab-separated row per event:",
    "",
    "  <start>\t<end>\t<summary>\t<id>",
    "",
    "--limit N   Rows to print, 0 or more. Default 20. 0 prints all.",
    "",
    "Runs `gog calendar events primary --today --all-pages --json --results-only` in this machine's timezone, so there is no model turn and no tokens. Times are what Google returns (RFC3339); an all-day event prints its date instead. When rows are held back, one trailing line says how many and how to see them. An empty result prints `nothing found`, which means no events today, not a failure.",
  ].join("\n"),
  from: [
    "/from <sender> [--limit N]",
    "",
    "Lists unread mail from one sender, one tab-separated row per message:",
    "",
    "  <date>\t<from>\t<subject>\t<id>",
    "",
    "<sender>    An email address or a name. Everything that is not --limit is the sender.",
    "--limit N   Rows to print, 0 or more. Default 20. 0 prints all.",
    "",
    "The sender is required. Without it the command prints this usage and searches nothing, so a bare /from can never turn into a whole-mailbox listing.",
    "",
    "Runs `gog gmail list 'is:unread from:\"<sender>\"' --all --json --results-only`, so there is no model turn and no tokens. When rows are held back, one trailing line says how many and how to see them. An empty result prints `nothing found`.",
  ].join("\n"),
  find: [
    "/find <name> [--limit N]",
    "",
    "Lists Drive files whose name contains a term, one tab-separated row per file:",
    "",
    "  <name>\t<folder|file>\t<id>\t<modifiedTime>",
    "",
    "<name>      Words to look for in the file name. Everything that is not --limit is the name.",
    "--limit N   Rows to print, 0 or more. Default 20. 0 prints all.",
    "",
    "The name is required. Without it the command prints this usage and searches nothing.",
    "",
    "Runs `gog drive ls --query \"name contains '<name>'\" --all --max 1000 --json --results-only`, across every file the account can see, so there is no model turn and no tokens. When rows are held back, one trailing line says how many and how to see them. An empty result prints `nothing found`.",
  ].join("\n"),
};

export interface CannedPlan {
  argv: string[];
  /** Rows to print: `--limit N`, 0 for all. */
  limit: number;
  /** Turns the parsed JSON list into output lines. */
  rows: (items: Record<string, unknown>[]) => string[];
}

export interface GogResult {
  ok: boolean;
  text: string;
}

/** `gog` takes minutes at worst; anything past this is a hung keyring or network. */
const TIMEOUT_MS = 30_000;

const INBOX_USAGE = "/inbox-new [--hours N] [--limit N]";
const DRIVE_USAGE = "/gdrive-root [--limit N]";
const AGENDA_USAGE = "/agenda [--limit N]";
const FROM_USAGE = "/from <sender> [--limit N]";
const FIND_USAGE = "/find <name> [--limit N]";

export interface InboxArgs {
  hours: number;
  limit: number;
}

/** `--hours N` and `--limit N` for /inbox-new; no arguments at all means 24 hours, 20 rows. */
export function parseInboxArgs(args: string): InboxArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  let hours = 24;
  let limit = DEFAULT_LIMIT;
  for (let index = 0; index < tokens.length; index++) {
    const flag = tokens[index];
    if (flag === "--hours") {
      const value = tokens[++index];
      if (value === undefined) throw new Error("--hours needs a number, 1 to 720.");
      if (!/^\d+$/.test(value)) throw new Error("--hours needs a whole number of hours, 1 to 720.");
      hours = Number(value);
      if (hours < 1 || hours > 720) throw new Error("--hours must be 1 to 720.");
    } else if (flag === "--limit") {
      limit = limitValue(tokens[++index]);
    } else {
      throw new Error(`Unknown argument ${flag}. Usage: ${INBOX_USAGE}`);
    }
  }
  return { hours, limit };
}

/** `--hours N` alone, kept for callers that only care about the window. */
export function parseHours(args: string): number {
  return parseInboxArgs(args).hours;
}

/** `--limit N` for /gdrive-root; `--limit` is its only argument. */
export function parseDriveLimit(args: string): number {
  return parseLimitOnly(args, DRIVE_USAGE);
}

/** `--limit N` for /agenda; `--limit` is its only argument. */
export function parseAgendaLimit(args: string): number {
  return parseLimitOnly(args, AGENDA_USAGE);
}

/** /from takes a sender and `--limit N`. No sender is an error: nothing may be searched by default. */
export function parseFromArgs(args: string): { sender: string; limit: number } {
  const { target, limit } = parseTargetAndLimit(args, FROM_USAGE);
  if (target === "") throw new Error(`No sender given, so nothing was searched. Usage: ${FROM_USAGE}`);
  return { sender: target, limit };
}

/** /find takes a name and `--limit N`. No name is an error, for the same reason as /from. */
export function parseFindArgs(args: string): { name: string; limit: number } {
  const { target, limit } = parseTargetAndLimit(args, FIND_USAGE);
  if (target === "") throw new Error(`No name given, so nothing was searched. Usage: ${FIND_USAGE}`);
  return { name: target, limit };
}

/** `--limit N` and nothing else. */
function parseLimitOnly(args: string, usage: string): number {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  let limit = DEFAULT_LIMIT;
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] !== "--limit")
      throw new Error(`Unknown argument ${tokens[index]}. ${usage} takes no arguments except --limit N.`);
    limit = limitValue(tokens[++index]);
  }
  return limit;
}

/**
 * Splits `<words...> [--limit N]`: every word that is not a flag belongs to the
 * target, so a sender or file name with spaces needs no quoting. Returns an
 * empty target rather than inventing one, and the caller decides whether that
 * is an error (it always is here — a default target would search too much).
 */
function parseTargetAndLimit(args: string, usage: string): { target: string; limit: number } {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const words: string[] = [];
  let limit = DEFAULT_LIMIT;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "--limit") limit = limitValue(tokens[++index]);
    else if (token.startsWith("--")) throw new Error(`Unknown argument ${token}. Usage: ${usage}`);
    else words.push(token);
  }
  return { target: words.join(" ").trim(), limit };
}

function limitValue(value: string | undefined): number {
  if (value === undefined) throw new Error("--limit needs a number, 0 or more. 0 means all.");
  if (!/^\d+$/.test(value)) throw new Error("--limit needs a whole number, 0 or more. 0 means all.");
  return Number(value);
}

export function plan(command: CannedCommand, args: string): CannedPlan {
  if (command === "gdrive-root") {
    return {
      argv: ["drive", "ls", "--no-input", "--json", "--results-only"],
      limit: parseDriveLimit(args),
      rows: (items) => items.map(driveRow),
    };
  }
  if (command === "agenda") {
    return {
      // --today is this machine's day, the same one the caller is living in.
      argv: ["calendar", "events", "primary", "--today", "--all-pages", "--no-input", "--json", "--results-only"],
      limit: parseAgendaLimit(args),
      rows: (items) => items.map(agendaRow),
    };
  }
  if (command === "from") {
    const { sender, limit } = parseFromArgs(args);
    return {
      // --all fetches every unread message from this one sender; the query is what
      // keeps it narrow, never the default page size.
      argv: ["gmail", "list", `is:unread from:${gmailPhrase(sender)}`, "--all", "--no-input", "--json", "--results-only"],
      limit,
      rows: (items) => items.map(mailRow),
    };
  }
  if (command === "find") {
    const { name, limit } = parseFindArgs(args);
    return {
      // --all lifts `ls` out of the root folder; --max is gog's ceiling for one call.
      argv: ["drive", "ls", "--query", driveNameContains(name), "--all", "--max", "1000", "--no-input", "--json", "--results-only"],
      limit,
      rows: (items) => items.map(driveRow),
    };
  }
  const { hours, limit } = parseInboxArgs(args);
  return {
    argv: ["gmail", "search", `is:unread newer_than:${hours}h`, "--no-input", "--json", "--results-only"],
    limit,
    rows: (items) => items.map(mailRow),
  };
}

function driveRow(item: Record<string, unknown>): string {
  return [
    oneLine(item.name),
    String(item.mimeType ?? "").endsWith(".folder") ? "folder" : "file",
    oneLine(item.id),
    oneLine(item.modifiedTime),
  ].join("\t");
}

function mailRow(item: Record<string, unknown>): string {
  return ["date", "from", "subject", "id"].map((key) => oneLine(item[key])).join("\t");
}

function agendaRow(item: Record<string, unknown>): string {
  return [eventTime(item.start), eventTime(item.end), oneLine(item.summary), oneLine(item.id)].join("\t");
}

/** An event time is `dateTime` for a timed event and `date` for an all-day one. */
function eventTime(value: unknown): string {
  if (value === null || typeof value !== "object") return "";
  const node = value as Record<string, unknown>;
  return oneLine(node.dateTime ?? node.date);
}

/** Gmail search syntax: quotes keep a name with spaces, or an operator, as one literal term. */
function gmailPhrase(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Drive query syntax: `name contains '<term>'`, with the term's quotes and backslashes escaped. */
function driveNameContains(value: string): string {
  return `name contains '${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Plans, runs, and shapes one canned command. Never throws: failures come back as `ok: false`. */
export async function runCanned(
  command: CannedCommand,
  args: string,
  timeoutMs = TIMEOUT_MS,
  runner: (argv: string[], timeoutMs: number) => Promise<GogResult> = runGog,
): Promise<GogResult> {
  let planned: CannedPlan;
  try {
    planned = plan(command, args);
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : "bad arguments." };
  }
  const outcome = await runner(planned.argv, timeoutMs);
  if (!outcome.ok) return outcome;
  let parsed: unknown;
  try {
    parsed = JSON.parse(outcome.text);
  } catch {
    return { ok: false, text: `gog printed something that is not JSON: ${oneLine(outcome.text).slice(0, 200)}` };
  }
  if (!Array.isArray(parsed)) return { ok: false, text: "gog printed JSON that is not a list." };
  const lines = planned.rows(parsed as Record<string, unknown>[]);
  if (lines.length === 0) return { ok: true, text: "nothing found" };
  const shown = planned.limit === 0 ? lines : lines.slice(0, planned.limit);
  const held = lines.length - shown.length;
  if (held > 0) {
    shown.push(
      `+${held} more row${held === 1 ? "" : "s"} not shown (${lines.length} total); run with --limit 0 to see all of them.`,
    );
  }
  return { ok: true, text: shown.join("\n") };
}

/** Runs `gog` with this process's environment, which the launcher filled from `.env`. */
export function runGog(argv: string[], timeoutMs = TIMEOUT_MS): Promise<GogResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("gog", argv, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ ok: false, text: `gog could not start: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    let out = "";
    let err = "";
    let settled = false;
    const finish = (result: GogResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, text: `gog did not answer in ${Math.round(timeoutMs / 1000)}s.` });
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (out += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (err += chunk));
    child.on("error", (error) => finish({ ok: false, text: `gog could not start: ${error.message}` }));
    child.on("close", (code) =>
      code === 0 ? finish({ ok: true, text: out }) : finish({ ok: false, text: failure(err, code) }),
    );
  });
}

/** `gog` reports trouble as tab-separated lines on stderr; keep the words, drop the tabs. */
function failure(err: string, code: number | null): string {
  const text = err
    .split(/\r?\n/)
    .map((line) => line.replace(/\t+/g, " ").trim())
    .filter(Boolean)
    .join(" / ");
  return text ? text.slice(0, 500) : `gog exited ${code ?? "without a status"}.`;
}

function oneLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
