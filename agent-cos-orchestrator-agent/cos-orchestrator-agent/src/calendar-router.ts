// Runs the `calendar` decision node from the harness and parses what it prints.
//
// The node owns the judgment (JEV's calendar class) and the destinations; this file
// only starts it, reads one JSON object, and fails open when anything goes wrong.
// Nothing here decides whether a message is a calendar entry.
import { spawn } from "node:child_process";
import path from "node:path";

/** One executed destination, as the node reports it. */
export interface RouteStatus {
  destination: string;
  status: string;
  note?: string;
  error?: string;
  agent?: string;
  seconds?: number;
  chars?: number;
  answer?: string;
}

/** One verdict from the node, in the shape the extension needs. */
export interface CalendarVerdict {
  ok: boolean;
  reason: string | null;
  abstained: boolean;
  isMatch: boolean;
  confidence: number | null;
  decision: string | null;
  rules: Record<string, number | null>;
  model: string | null;
  latencyMs: number | null;
  routes: RouteStatus[];
}

/** The caller script: `~/.pi/decision-nodes/calendar/route.py`. */
export function routeScript(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.HOME ?? "", ".pi", "decision-nodes", "calendar", "route.py");
}

const EMPTY: CalendarVerdict = {
  ok: false,
  reason: null,
  abstained: true,
  isMatch: false,
  confidence: null,
  decision: null,
  rules: {},
  model: null,
  latencyMs: null,
  routes: [],
};

/** A verdict that routed nothing. Every failure path returns this. */
export function noVerdict(reason: string): CalendarVerdict {
  return { ...EMPTY, reason };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Map the node's JSON to a verdict. Throws when the object cannot be trusted, so a
 * half-written answer is never mistaken for a non-match.
 */
export function parseRouteOutput(stdout: string): CalendarVerdict {
  const parsed: unknown = JSON.parse(stdout.trim());
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("route.py did not print an object");
  }
  const row = parsed as Record<string, unknown>;
  if (typeof row.abstained !== "boolean") throw new Error("route.py printed no abstained flag");

  const calendar = (row.calendar ?? null) as Record<string, unknown> | null;
  if (!row.abstained && (!calendar || typeof calendar.is_match !== "boolean")) {
    throw new Error("route.py printed no calendar verdict");
  }

  const routes = Array.isArray(row.routes)
    ? row.routes.filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
        .map((r) => ({
          destination: String(r.destination ?? "?"),
          status: String(r.status ?? "?"),
          note: typeof r.note === "string" ? r.note : undefined,
          error: typeof r.error === "string" ? r.error : undefined,
          agent: typeof r.agent === "string" ? r.agent : undefined,
          seconds: numberOrNull(r.seconds) ?? undefined,
          chars: numberOrNull(r.chars) ?? undefined,
          answer: typeof r.answer === "string" ? r.answer : undefined,
        }))
    : [];

  const rules: Record<string, number | null> = {};
  for (const [name, value] of Object.entries((calendar?.rules ?? {}) as Record<string, unknown>)) {
    rules[name] = numberOrNull(value);
  }

  return {
    ok: true,
    reason: typeof row.reason === "string" ? row.reason : null,
    abstained: row.abstained,
    isMatch: calendar?.is_match === true,
    confidence: numberOrNull(calendar?.confidence),
    decision: typeof calendar?.decision === "string" ? calendar.decision : null,
    rules,
    model: typeof row.model === "string" ? row.model : null,
    latencyMs: numberOrNull(row.latency_ms),
    routes,
  };
}

export interface RunOptions {
  dryRun?: boolean;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  script?: string;
  /** Injected in tests; defaults to spawning python3. */
  python?: string;
}

/**
 * Ask the node about one utterance. Never throws: a timeout, a missing script, or
 * unparsable output comes back as `ok: false` with a reason, which the caller must
 * treat as "route nothing and let the turn happen".
 */
export function runCalendarRoute(text: string, options: RunOptions = {}): Promise<CalendarVerdict> {
  const script = options.script ?? routeScript(options.env);
  const python = options.python ?? "python3";
  const timeoutMs = options.timeoutMs ?? 330_000;
  const args = [script, "--text", text, "--json"];
  if (options.dryRun) args.push("--dry-run");

  return new Promise((resolve) => {
    const child = spawn(python, args, { env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let settled = false;
    const finish = (verdict: CalendarVerdict) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(verdict);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(noVerdict(`route.py timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      err += chunk;
    });
    child.on("error", (error: Error) => finish(noVerdict(`route.py not runnable: ${error.message}`)));
    child.on("close", (code) => {
      if (settled) return;
      if (code === 2 || !out.trim()) {
        finish(noVerdict((err || `route.py exited ${code}`).trim().slice(-300)));
        return;
      }
      try {
        finish(parseRouteOutput(out));
      } catch (error) {
        finish(noVerdict(`route.py output unreadable: ${(error as Error).message}`));
      }
    });
  });
}

const conf = (value: number | null): string => (value === null ? "?" : value.toFixed(3));

/** One line per step, for the screen. Mirrors the node's own report. */
export function traceLines(verdict: CalendarVerdict): string[] {
  if (!verdict.ok) return [`[calendar] no verdict: ${verdict.reason ?? "unknown"} - turn continues`];
  if (verdict.abstained) return [`[calendar] no verdict: ${verdict.reason ?? "abstained"} - turn continues`];

  const latency = verdict.latencyMs === null ? "" : `  ${verdict.latencyMs} ms`;
  const lines = [
    `[jev]   calendar ${verdict.isMatch ? "true" : "false"} ${conf(verdict.confidence)} (${verdict.decision ?? "?"})${latency}`,
  ];
  if (!verdict.routes.length) {
    lines.push("[route] none - ordinary turn");
    return lines;
  }
  for (const route of verdict.routes) {
    const detail = route.note ?? route.error ?? (route.agent ? `${route.agent} ${route.seconds ?? "?"} s` : "");
    lines.push(`[route] ${route.destination.padEnd(19)} ${route.status}${detail ? `  ${detail}` : ""}`);
  }
  return lines;
}

/**
 * The hidden block the model receives after a match. It states that routing already
 * happened, so the turn relays instead of repeating the work - and it forbids
 * claiming a creation that is still a stub.
 */
export function contextBlock(verdict: CalendarVerdict): string {
  const lines = [
    "calendarRouter - deterministic, already executed before this turn",
    `judgment: calendar ${verdict.isMatch ? "true" : "false"}, confidence ${conf(verdict.confidence)}, ` +
      `decision ${verdict.decision ?? "?"}, model ${verdict.model ?? "?"}`,
    "routes:",
  ];
  for (const route of verdict.routes) {
    const detail = route.status === "ran"
      ? `ran - ${route.agent ?? "agent"} in ${route.seconds ?? "?"} s`
      : route.status === "stub"
        ? "stub - not implemented yet"
        : route.status;
    lines.push(`  ${route.destination} -> ${detail}`);
  }
  lines.push(
    "The hand-off has already happened. Do not call the router or the sibling again.",
    "Relay the answer below in a few lines. Do not claim the event was created: creation is the",
    "destination that is still a stub.",
  );
  const answer = verdict.routes.find((route) => route.answer)?.answer;
  if (answer) lines.push("", "answer:", answer);
  return lines.join("\n");
}
