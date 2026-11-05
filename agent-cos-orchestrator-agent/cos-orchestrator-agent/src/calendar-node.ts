// Runs the `calendar` decision node from the harness and parses what it prints.
//
// The classifier's arbiter owns the judgment and the node owns the destinations; this
// file only starts the node, reads one JSON object, and fails open when anything goes
// wrong. Nothing here decides whether a message is a calendar entry.
import { spawn } from "node:child_process";
import path from "node:path";

/** One executed destination, as the node reports it. */
export interface RouteStatus {
  destination: string;
  status: string;
  note?: string;
  error?: string;
  agent?: string;
  /** What produced the read: "gog calendar freebusy". */
  source?: string;
  seconds?: number;
  chars?: number;
  answer?: string;
  /** Present when the write ran: what was written, and its id and link. */
  event?: {
    summary?: string;
    location?: string | null;
    start?: string;
    end?: string;
    id?: string | null;
    link?: string | null;
    attendees?: string;
    reminders?: string;
    rrule?: string;
  };
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
  /** The arbiter's winner class and band, when the node reported them. */
  winner: string | null;
  band: string | null;
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
  winner: null,
  band: null,
};

/** A verdict that routed nothing. Every failure path returns this. */
export function noVerdict(reason: string): CalendarVerdict {
  return { ...EMPTY, reason };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** The written event, when the node reports one. */
function eventOf(value: unknown): RouteStatus["event"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const event = value as Record<string, unknown>;
  return {
    summary: textOrUndefined(event.summary),
    location: typeof event.location === "string" ? event.location : null,
    start: textOrUndefined(event.start),
    end: textOrUndefined(event.end),
    id: typeof event.id === "string" ? event.id : null,
    link: typeof event.link === "string" ? event.link : null,
    attendees: textOrUndefined(event.attendees),
    reminders: textOrUndefined(event.reminders),
    rrule: textOrUndefined(event.rrule),
  };
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
          source: typeof r.source === "string" ? r.source : undefined,
          seconds: numberOrNull(r.seconds) ?? undefined,
          chars: numberOrNull(r.chars) ?? undefined,
          answer: typeof r.answer === "string" ? r.answer : undefined,
          event: eventOf(r.event),
        }))
    : [];

  const rules: Record<string, number | null> = {};
  for (const [name, value] of Object.entries((calendar?.rules ?? {}) as Record<string, unknown>)) {
    rules[name] = numberOrNull(value);
  }
  const winner = (row.winner ?? null) as Record<string, unknown> | null;

  return {
    winner: typeof winner?.class === "string" ? winner.class : null,
    band: typeof winner?.band === "string" ? winner.band : null,
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
  /** classify.py --json output already fetched for this text (src/jev-classify.ts). */
  classifierJson?: string;
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
export function runCalendarNode(text: string, options: RunOptions = {}): Promise<CalendarVerdict> {
  const script = options.script ?? routeScript(options.env);
  const python = options.python ?? "python3";
  const timeoutMs = options.timeoutMs ?? 330_000;
  const args = [script, "--text", text, "--json"];
  if (options.dryRun) args.push("--dry-run");
  if (options.classifierJson) args.push("--classifier-json", options.classifierJson);

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
    const bits = [
      route.note ?? route.error,
      route.source ?? route.agent,
      route.seconds === undefined ? undefined : `${route.seconds} s`,
    ].filter((bit): bit is string => !!bit);
    lines.push(`[route] ${route.destination.padEnd(19)} ${route.status}${bits.length ? `  ${bits.join(" · ")}` : ""}`);
  }
  return lines;
}

/**
 * The outcome lines for a turn the extension finishes itself: the node already did the
 * work, so this is the whole reply. Created shows the event and its link; anything else
 * shows the one reason it was not created.
 */
export function outcomeLines(verdict: CalendarVerdict): string[] {
  const created = verdict.routes.find((route) => route.status === "created");
  if (created) {
    const event = created.event ?? {};
    const lines = [`→ created: ${event.summary ?? created.note ?? "?"}`];
    if (event.start) lines.push(`  ${event.start} → ${event.end ?? "?"}`);
    if (event.location) lines.push(`  ${event.location}`);
    if (event.attendees) lines.push(`  ${event.attendees}`);
    if (event.reminders) lines.push(`  ${event.reminders}`);
    if (event.rrule) lines.push(`  ${event.rrule}`);
    if (event.link) lines.push(`  ${event.link}`);
    return lines;
  }
  const write = verdict.routes.find((route) => route.destination === "do:calendar:create");
  const read = verdict.routes.find((route) => route.destination === "do:calendar:gog");
  const reason = write?.note ?? write?.error ?? read?.note ?? read?.error ?? write?.status ?? "not created";
  return [`→ not created: ${reason}`];
}

/**
 * The whole reply for a Telegram turn the extension finishes itself: the outcome, and
 * optionally the trace. Plain text, phone-width, no markup to escape.
 */
export function telegramReply(verdict: CalendarVerdict, withTrace: boolean): string {
  const lines = outcomeLines(verdict).map((line) => line.replace(/^→ /, ""));
  if (!withTrace) return lines.join("\n");

  const read = verdict.routes.find((route) => route.destination === "do:calendar:gog");
  const write = verdict.routes.find((route) => route.destination === "do:calendar:create");
  const bits = [
    `calendar ${verdict.isMatch ? "true" : "false"} ${conf(verdict.confidence)}`,
    read?.note ? `read ${read.note}` : undefined,
    write?.seconds === undefined ? undefined : `write ${write.seconds} s`,
  ].filter((bit): bit is string => !!bit);
  lines.push("", bits.join(" · "));
  return lines.join("\n");
}

/**
 * True when the node wrote nothing because it was unsure: the arbiter's hint band, or
 * the extractor disagreeing with the classifier. The turn then runs with hintBlock.
 */
export function isUnsure(verdict: CalendarVerdict): boolean {
  return verdict.routes.some((route) => route.status === "hint" || route.status === "downgraded");
}

/** The hidden block for an unsure verdict: nothing was written, ask before writing. */
export function hintBlock(verdict: CalendarVerdict): string {
  const why = verdict.routes.find((route) => route.status === "hint" || route.status === "downgraded");
  return [
    "calendarNode - unsure, nothing was written",
    `reason: ${why?.note ?? "low confidence"}`,
    "This message may be asking for a new calendar event. Do not create one yourself.",
    "If it is a request, ask the user to confirm the title, day and time; otherwise answer normally.",
  ].join("\n");
}

/**
 * The hidden block the model receives after a match. It states that routing already
 * happened, so the turn relays instead of repeating the work - and it forbids
 * claiming a creation that did not happen.
 */
export function contextBlock(verdict: CalendarVerdict): string {
  const lines = [
    "calendarNode - deterministic, already executed before this turn",
    `judgment: calendar ${verdict.isMatch ? "true" : "false"}, confidence ${conf(verdict.confidence)}, ` +
      `decision ${verdict.decision ?? "?"}, model ${verdict.model ?? "?"}`,
    "routes:",
  ];
  for (const route of verdict.routes) {
    const detail = route.note ?? route.error ??
      (route.agent ? `ran - ${route.agent} in ${route.seconds ?? "?"} s` : route.status);
    lines.push(`  ${route.destination} -> ${route.status}${detail ? ` (${detail})` : ""}`);
  }
  lines.push(
    "The node has already run: the slot was checked with gog and the write either happened or",
    "was skipped for the reason below. Do not run the node, gog, or a sibling agent again.",
  );

  const created = verdict.routes.find((route) => route.status === "created");
  if (created) {
    const event = created.event ?? {};
    lines.push(
      "The event WAS created. Report it plainly, with its time and its link when present.",
      "Creating it again would put a SECOND identical event on the calendar - do not do that.",
      `created: ${event.summary ?? "?"} · ${event.start ?? "?"} -> ${event.end ?? "?"}` +
        (event.location ? ` · ${event.location}` : "") +
        (event.link ? ` · ${event.link}` : ""),
    );
  } else {
    lines.push(
      "No event was created - do not claim one was. Say why in one line, using the",
      "route note above (a BUSY or UNKNOWN read, missing fields, or low confidence).",
    );
  }

  const answer = verdict.routes.find((route) => route.answer)?.answer;
  if (answer) lines.push("", "calendar check:", answer);
  return lines.join("\n");
}
