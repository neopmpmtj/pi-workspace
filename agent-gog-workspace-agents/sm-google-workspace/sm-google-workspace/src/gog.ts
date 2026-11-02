// Canned `gog` commands: the fast path for requests made often.
//
// A chat turn costs seconds and tokens: the model reads the task, chooses a
// command, then reads the output and writes an answer. A canned command skips
// the model entirely — it runs one fixed `gog` command, shapes the JSON, and
// prints it. No tokens, well under a second. The price is a fixed phrasing: it
// answers exactly one question and takes no rewriting.
import { spawn } from "node:child_process";

export const CANNED = ["gdrive-root", "inbox-new"] as const;
export type CannedCommand = (typeof CANNED)[number];

export const CANNED_DESCRIPTION: Record<CannedCommand, string> = {
  "gdrive-root": "Root of Google Drive: name, folder|file, id, modified — one tab-separated row per item. No model turn, no tokens.",
  "inbox-new": "Unread mail newer than N hours (default 24): date, from, subject, id. No model turn, no tokens.",
};

export const GOG_HELP: Record<CannedCommand, string> = {
  "gdrive-root": [
    "/gdrive-root",
    "",
    "Lists what sits in the root of Google Drive, one tab-separated row per item:",
    "",
    "  <name>\t<folder|file>\t<id>\t<modifiedTime>",
    "",
    "Takes no arguments. Runs `gog drive ls --json --results-only`, so there is no model turn and no tokens.",
  ].join("\n"),
  "inbox-new": [
    "/inbox-new [--hours N]",
    "",
    "Lists unread mail newer than N hours, one tab-separated row per message:",
    "",
    "  <date>\t<from>\t<subject>\t<id>",
    "",
    "--hours N   1 to 720. Default 24.",
    "",
    "Runs `gog gmail search 'is:unread newer_than:Nh' --json --results-only`, so there is no model turn and no tokens. An empty result prints `nothing found`.",
  ].join("\n"),
};

export interface CannedPlan {
  argv: string[];
  /** Turns the parsed JSON list into output lines. */
  rows: (items: Record<string, unknown>[]) => string[];
}

export interface GogResult {
  ok: boolean;
  text: string;
}

/** `gog` takes minutes at worst; anything past this is a hung keyring or network. */
const TIMEOUT_MS = 30_000;

/** `--hours N` for /inbox-new; no arguments at all means 24. */
export function parseHours(args: string): number {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  let hours = 24;
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] !== "--hours") throw new Error(`Unknown argument ${tokens[index]}. Usage: /inbox-new [--hours N]`);
    const value = tokens[++index];
    if (value === undefined) throw new Error("--hours needs a number, 1 to 720.");
    if (!/^\d+$/.test(value)) throw new Error("--hours needs a whole number of hours, 1 to 720.");
    hours = Number(value);
    if (hours < 1 || hours > 720) throw new Error("--hours must be 1 to 720.");
  }
  return hours;
}

export function plan(command: CannedCommand, args: string): CannedPlan {
  if (command === "gdrive-root") {
    if (args.trim()) throw new Error("/gdrive-root takes no arguments.");
    return {
      argv: ["drive", "ls", "--no-input", "--json", "--results-only"],
      rows: (items) =>
        items.map((item) =>
          [
            oneLine(item.name),
            String(item.mimeType ?? "").endsWith(".folder") ? "folder" : "file",
            oneLine(item.id),
            oneLine(item.modifiedTime),
          ].join("\t"),
        ),
    };
  }
  const hours = parseHours(args);
  return {
    argv: ["gmail", "search", `is:unread newer_than:${hours}h`, "--no-input", "--json", "--results-only"],
    rows: (items) =>
      items.map((item) => ["date", "from", "subject", "id"].map((key) => oneLine(item[key])).join("\t")),
  };
}

/** Plans, runs, and shapes one canned command. Never throws: failures come back as `ok: false`. */
export async function runCanned(command: CannedCommand, args: string, timeoutMs = TIMEOUT_MS): Promise<GogResult> {
  let planned: CannedPlan;
  try {
    planned = plan(command, args);
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : "bad arguments." };
  }
  const outcome = await runGog(planned.argv, timeoutMs);
  if (!outcome.ok) return outcome;
  let parsed: unknown;
  try {
    parsed = JSON.parse(outcome.text);
  } catch {
    return { ok: false, text: `gog printed something that is not JSON: ${oneLine(outcome.text).slice(0, 200)}` };
  }
  if (!Array.isArray(parsed)) return { ok: false, text: "gog printed JSON that is not a list." };
  const lines = planned.rows(parsed as Record<string, unknown>[]);
  return { ok: true, text: lines.length > 0 ? lines.join("\n") : "nothing found" };
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
