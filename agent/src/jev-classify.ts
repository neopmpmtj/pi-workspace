// One JEV classification per prompt, shared by every decision-node hook.
//
// The calendar and reminder hooks both need the arbiter's winner for the same message.
// pi loads each extension with its own module cache, so a module-level memo would not be
// shared: the memo lives on globalThis under a registered symbol instead.
//
// Pre-filters skip the classifier for slash commands, code, and a message that is only a
// path, a URL, or an email address. Every classified message is appended to
// ~/.pi/decision-nodes/review.jsonl (gitignored), and rows older than REVIEW_DAYS go.
import { spawn } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inputContainsEmail } from "./input-contains-email.ts";
import { inputContainsPath } from "./input-contains-path.ts";
import { inputContainsUrl } from "./input-contains-url.ts";
import { readModeSwitch } from "./global-config.ts";
import { isModeAck } from "./mode-ack.ts";
import { detectModeRequest } from "./mode-detect.ts";
import { cleanPrompt } from "./prompt-text.ts";

export const REVIEW_DAYS = 14;

/** The arbiter's answer, as classify.py --json prints it. */
export interface JevWinner {
  class: string;
  confidence: number | null;
  band: "act" | "hint" | "none";
  vetoed_by: string[];
  capped_by: string[];
}

export interface JevClassification {
  ok: boolean;
  /** The cleaned text that was classified. */
  text: string;
  /** Set when a pre-filter skipped the classifier. */
  skipped?: string;
  /** Set when the classifier failed; the turn continues as if nothing ran. */
  reason?: string;
  winner?: JevWinner;
  /** The full classify.py payload, written for route.py --classifier-json. */
  file?: string;
  latencyMs?: number;
}

export interface ClassifyOptions {
  env?: NodeJS.ProcessEnv;
  script?: string;
  python?: string;
  timeoutMs?: number;
  reviewFile?: string;
  now?: Date;
}

interface Shared {
  raw: string | null;
  pending: Promise<JevClassification> | null;
  last: JevClassification | null;
  announced: string | null;
}

const KEY = Symbol.for("cos-orchestrator-agent.jev-classify");

function shared(): Shared {
  const holder = globalThis as unknown as Record<symbol, Shared | undefined>;
  holder[KEY] ??= { raw: null, pending: null, last: null, announced: null };
  return holder[KEY];
}

/** Forget the memo. Tests only. */
export function resetJevClassify(): void {
  const state = shared();
  state.raw = null;
  state.pending = null;
  state.last = null;
  state.announced = null;
}

export function classifyScript(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.HOME ?? "", ".pi", "jev-classifier", "jev-classifier-multi", "src", "classify.py");
}

export function reviewFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.HOME ?? "", ".pi", "decision-nodes", "review.jsonl");
}

// Kept in step with clean() in decision-nodes/*/route.py.
export { cleanPrompt } from "./prompt-text.ts";

/** Why the classifier is not worth asking about this text, or null when it is. */
export function skipReason(text: string): string | null {
  if (!text) return "empty";
  if (text.startsWith("/")) return "slash command";
  if (text.includes("```")) return "code block";
  let rest = text;
  const found = [inputContainsPath(text)?.path, inputContainsUrl(text)?.url,
    ...inputContainsEmail(text).map((email) => email.address)];
  for (const span of found) if (span) rest = rest.replace(span, " ");
  const words = rest.replace(/["'`]/g, " ").split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  if (found.some(Boolean) && words.length < 2) return "only a path, URL, or email";
  return null;
}

/**
 * The classification for this prompt. A second caller with the same prompt gets the
 * same promise, so a message is classified once whichever hook asks first.
 */
export async function classifyPrompt(raw: string, options: ClassifyOptions = {}): Promise<JevClassification> {
  // A mode request is answered by the mode-switch hook, in whatever order pi loaded it.
  // With that gate on, the classifier never sees one: no classifier call, no review row, no
  // decision node. The gate off means the hook is off, so the text is classified as usual.
  if (isModeAck(raw)) {
    return { ok: false, text: cleanPrompt(raw), skipped: "mode switch" };
  }
  if (detectModeRequest(raw) && (await readModeSwitch(options.env))) {
    return { ok: false, text: cleanPrompt(raw), skipped: "mode request" };
  }
  const state = shared();
  if (state.raw === raw && state.pending) return state.pending;
  state.raw = raw;
  state.announced = null;
  state.pending = classifyOnce(raw, options).then((result) => {
    state.last = result;
    return result;
  });
  return state.pending;
}

/** The last classified message, for /jev-wrong. Null before the first one. */
export function lastClassification(): JevClassification | null {
  return shared().last;
}

/**
 * True once per prompt: the first hook to ask prints the winner line, the others stay
 * quiet, so the screen shows one [jev] line however many nodes listen.
 */
export function claimAnnouncement(raw: string): boolean {
  const state = shared();
  if (state.announced === raw) return false;
  state.announced = raw;
  return true;
}

const conf = (value: number | null | undefined): string =>
  typeof value === "number" ? value.toFixed(3) : "?";

/** One screen line for the winner. */
export function winnerLine(result: JevClassification): string {
  if (result.skipped) return `[jev]   skipped (${result.skipped})`;
  if (!result.ok || !result.winner) return `[jev]   no verdict: ${result.reason ?? "unknown"} - turn continues`;
  const winner = result.winner;
  const stopped = [...winner.vetoed_by, ...winner.capped_by];
  const latency = result.latencyMs === undefined ? "" : `  ${result.latencyMs} ms`;
  return `[jev]   winner ${winner.class} ${winner.band} ${conf(winner.confidence)}` +
    (stopped.length ? `  vetoes ${stopped.join(", ")}` : "") + latency;
}

async function classifyOnce(raw: string, options: ClassifyOptions): Promise<JevClassification> {
  const text = cleanPrompt(raw);
  const skipped = skipReason(text);
  if (skipped) return { ok: false, text, skipped };

  const started = Date.now();
  const run = await runClassifier(text, options);
  if (!run.ok) return { ok: false, text, reason: run.reason };

  const latencyMs = Date.now() - started;
  const payload = run.payload as Record<string, unknown>;
  const winner = readWinner(payload.winner);
  if (!winner) return { ok: false, text, reason: "classifier JSON has no winner" };

  payload.latency_ms = latencyMs;
  const file = path.join(tmpdir(), `jev-classify-${process.pid}.json`);
  await writeFile(file, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
  const result: JevClassification = { ok: true, text, winner, file, latencyMs };
  await appendReview(result, raw, options).catch(() => undefined);
  return result;
}

function readWinner(value: unknown): JevWinner | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const winner = value as Record<string, unknown>;
  if (typeof winner.class !== "string") return null;
  const band = winner.band === "act" || winner.band === "hint" ? winner.band : "none";
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    class: winner.class,
    confidence: typeof winner.confidence === "number" ? winner.confidence : null,
    band,
    vetoed_by: list(winner.vetoed_by),
    capped_by: list(winner.capped_by),
  };
}

function runClassifier(text: string, options: ClassifyOptions): Promise<{ ok: true; payload: unknown } | { ok: false; reason: string }> {
  const script = options.script ?? classifyScript(options.env);
  const python = options.python ?? "python3";
  const timeoutMs = options.timeoutMs ?? 45_000;
  return new Promise((resolve) => {
    const child = spawn(python, [script, "--json", text], { env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let settled = false;
    const finish = (value: { ok: true; payload: unknown } | { ok: false; reason: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, reason: `classifier timed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { out += chunk; });
    child.stderr.on("data", (chunk: string) => { err += chunk; });
    child.on("error", (error: Error) => finish({ ok: false, reason: `classifier not runnable: ${error.message}` }));
    child.on("close", (code) => {
      if (code !== 0 || !out.trim()) {
        finish({ ok: false, reason: (err || `classifier exited ${code}`).trim().slice(-300) });
        return;
      }
      try {
        finish({ ok: true, payload: JSON.parse(out) as unknown });
      } catch {
        finish({ ok: false, reason: "classifier printed no JSON" });
      }
    });
  });
}

async function appendReview(result: JevClassification, raw: string, options: ClassifyOptions): Promise<void> {
  const file = options.reviewFile ?? reviewFile(options.env);
  const now = options.now ?? new Date();
  const row = {
    ts: now.toISOString(),
    text: result.text,
    surface: /^\s*\[telegram/i.test(raw) ? "telegram" : "local",
    winner: result.winner?.class,
    band: result.winner?.band,
    confidence: result.winner?.confidence,
    vetoed_by: result.winner?.vetoed_by,
    capped_by: result.winner?.capped_by,
  };
  await pruneReview(file, now);
  await appendFile(file, `${JSON.stringify(row)}\n`, "utf8");
}

/** Drop rows older than REVIEW_DAYS. Rewrites the file only when something expired. */
export async function pruneReview(file: string, now: Date = new Date()): Promise<number> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return 0;
  }
  const cutoff = now.getTime() - REVIEW_DAYS * 86_400_000;
  const lines = text.split("\n").filter(Boolean);
  const kept = lines.filter((line) => {
    try {
      const ts = Date.parse((JSON.parse(line) as { ts?: string }).ts ?? "");
      return Number.isFinite(ts) && ts >= cutoff;
    } catch {
      return false;
    }
  });
  if (kept.length === lines.length) return 0;
  await writeFile(file, kept.length ? `${kept.join("\n")}\n` : "", "utf8");
  return lines.length - kept.length;
}
