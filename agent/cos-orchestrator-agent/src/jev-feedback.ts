// Feedback for the JEV classifier: /jev-wrong labels the last classified message into the
// eval set, and /calendar-undo deletes the last event the calendar node created.
import { spawn } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { routeScript } from "./calendar-node.ts";

export const JEV_LABELS = ["calendar", "reminder", "reminder_done", "none"] as const;
export type JevLabel = (typeof JEV_LABELS)[number];

export function goldenFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.HOME ?? "", ".pi", "jev-classifier", "eval", "jev-golden.jsonl");
}

export function parseJevLabel(args: string): JevLabel | null {
  const word = args.trim().toLowerCase().replace(/-/g, "_");
  return (JEV_LABELS as readonly string[]).includes(word) ? (word as JevLabel) : null;
}

/**
 * Append one labelled phrase to the eval set. A phrase already in the set is relabelled
 * by a newer line only if the label differs; the eval reads the last line per phrase.
 */
export async function appendGolden(text: string, label: JevLabel, got: string, file: string):
  Promise<"added" | "unchanged"> {
  let existing = "";
  try {
    existing = await readFile(file, "utf8");
  } catch {
    existing = "";
  }
  const same = existing.split("\n").filter(Boolean).reverse().find((line) => {
    try {
      return (JSON.parse(line) as { text?: string }).text === text;
    } catch {
      return false;
    }
  });
  if (same && (JSON.parse(same) as { expect?: string }).expect === label) return "unchanged";
  const row = { text, expect: label, lang: "unknown", tag: `jev-wrong:${got}` };
  await appendFile(file, `${JSON.stringify(row)}\n`, "utf8");
  return "added";
}

/** `route.py --undo --json` in the calendar node. */
export function runCalendarUndo(env: NodeJS.ProcessEnv = process.env, script = routeScript(env)):
  Promise<{ status: string; note: string; event_id?: string }> {
  return new Promise((resolve) => {
    const child = spawn("python3", [script, "--undo", "--json"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { out += chunk; });
    child.stderr.on("data", (chunk: string) => { err += chunk; });
    child.on("error", (error: Error) => resolve({ status: "failed", note: `route.py not runnable: ${error.message}` }));
    child.on("close", (code) => {
      try {
        resolve(JSON.parse(out.trim()) as { status: string; note: string; event_id?: string });
      } catch {
        resolve({ status: "failed", note: (err || `route.py exited ${code}`).trim().slice(-300) });
      }
    });
  });
}
