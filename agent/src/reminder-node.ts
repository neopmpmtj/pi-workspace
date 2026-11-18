// Runs the `reminder` decision node from the harness and parses what it prints.
//
// The classifier's arbiter owns the judgment and the node owns the destinations and the
// reminders table (~/.pi/decision-nodes/reminder/reminders.jsonl); this file only starts
// the node, reads one JSON object, and fails open when anything goes wrong.
import { spawn } from "node:child_process";
import path from "node:path";

/** One executed destination, as the node reports it. */
export interface ReminderRoute {
  destination: string;
  status: string;
  note?: string;
  error?: string;
  seconds?: number;
  /** do:reminder:log - the row written to the table. */
  reminder?: { id: string; title: string; due: string };
  /** do:reminder:calendar - the event written. */
  event?: { id?: string | null; link?: string | null; start?: string };
  /** do:reminder:done - which reminder closed, and what happened to its event. */
  id?: string;
  title?: string;
  eventAction?: string;
  /** do:reminder:done with no match - what is still open. */
  pending?: Array<{ id: string; title: string; due: string }>;
  /** do:reminder:tasks - the Google Task written. */
  task?: { id: string | null; title: string; due: string; list_id?: string };
}

export interface ReminderVerdict {
  ok: boolean;
  reason: string | null;
  abstained: boolean;
  winner: string | null;
  band: string | null;
  confidence: number | null;
  model: string | null;
  latencyMs: number | null;
  routes: ReminderRoute[];
}

/** One row of the reminders table, as `route.py --list --json` prints it. */
export interface ReminderRow {
  id: string;
  title: string | null;
  due: string | null;
  status: string;
  event_id?: string | null;
  link?: string | null;
}

export function reminderRouteScript(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.HOME ?? "", ".pi", "decision-nodes", "reminder", "route.py");
}

export function noReminderVerdict(reason: string): ReminderVerdict {
  return { ok: false, reason, abstained: true, winner: null, band: null, confidence: null,
    model: null, latencyMs: null, routes: [] };
}

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

function routeOf(r: Record<string, unknown>): ReminderRoute {
  const reminder = r.reminder as Record<string, unknown> | undefined;
  const event = r.event;
  const route: ReminderRoute = {
    destination: String(r.destination ?? "?"),
    status: String(r.status ?? "?"),
    note: str(r.note),
    error: str(r.error),
    seconds: num(r.seconds) ?? undefined,
    id: str(r.id),
    title: str(r.title),
  };
  if (reminder && typeof reminder === "object") {
    route.reminder = { id: String(reminder.id ?? ""), title: String(reminder.title ?? ""), due: String(reminder.due ?? "") };
  }
  if (event && typeof event === "object") {
    const e = event as Record<string, unknown>;
    route.event = { id: typeof e.id === "string" ? e.id : null, link: typeof e.link === "string" ? e.link : null, start: str(e.start) };
  } else if (typeof event === "string") {
    route.eventAction = event;
  }
  if (Array.isArray(r.pending)) {
    route.pending = r.pending.filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p) => ({ id: String(p.id ?? ""), title: String(p.title ?? ""), due: String(p.due ?? "") }));
  }
  const task = r.task;
  if (task && typeof task === "object") {
    const t = task as Record<string, unknown>;
    route.task = {
      id: typeof t.id === "string" ? t.id : null,
      title: String(t.title ?? ""),
      due: String(t.due ?? ""),
      list_id: typeof t.list_id === "string" ? t.list_id : undefined,
    };
  }
  return route;
}

/** Map the node's JSON to a verdict. Throws when the object cannot be trusted. */
export function parseReminderOutput(stdout: string): ReminderVerdict {
  const parsed: unknown = JSON.parse(stdout.trim());
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("route.py did not print an object");
  const row = parsed as Record<string, unknown>;
  if (typeof row.abstained !== "boolean") throw new Error("route.py printed no abstained flag");
  const winner = (row.winner ?? null) as Record<string, unknown> | null;
  if (!row.abstained && (!winner || typeof winner.class !== "string")) throw new Error("route.py printed no winner");
  const routes = Array.isArray(row.routes)
    ? row.routes.filter((r): r is Record<string, unknown> => !!r && typeof r === "object").map(routeOf)
    : [];
  return {
    ok: true,
    reason: typeof row.reason === "string" ? row.reason : null,
    abstained: row.abstained,
    winner: typeof winner?.class === "string" ? winner.class : null,
    band: typeof winner?.band === "string" ? winner.band : null,
    confidence: num(winner?.confidence),
    model: typeof row.model === "string" ? row.model : null,
    latencyMs: num(row.latency_ms),
    routes,
  };
}

export interface ReminderRunOptions {
  dryRun?: boolean;
  /** False passes --no-writes. Prefer writer. */
  writes?: boolean;
  /** Exclusive writer passed as --writer. off / writes: false pass --no-writes. */
  writer?: "store" | "tasks" | "off";
  classifierJson?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  script?: string;
  python?: string;
}

function runScript(args: string[], options: ReminderRunOptions): Promise<{ code: number | null; out: string; err: string; failure?: string }> {
  const script = options.script ?? reminderRouteScript(options.env);
  const python = options.python ?? "python3";
  const timeoutMs = options.timeoutMs ?? 120_000;
  return new Promise((resolve) => {
    const child = spawn(python, [script, ...args], { env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let settled = false;
    const finish = (value: { code: number | null; out: string; err: string; failure?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: null, out, err, failure: `route.py timed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { out += chunk; });
    child.stderr.on("data", (chunk: string) => { err += chunk; });
    child.on("error", (error: Error) => finish({ code: null, out, err, failure: `route.py not runnable: ${error.message}` }));
    child.on("close", (code) => finish({ code, out, err }));
  });
}

/** Ask the node about one utterance. Never throws; failures come back as ok: false. */
export async function runReminderNode(text: string, options: ReminderRunOptions = {}): Promise<ReminderVerdict> {
  const args = ["--text", text, "--json"];
  if (options.dryRun) args.push("--dry-run");
  if (options.writer === "off" || options.writes === false) args.push("--no-writes");
  else if (options.writer === "store" || options.writer === "tasks") args.push("--writer", options.writer);
  if (options.classifierJson) args.push("--classifier-json", options.classifierJson);
  const run = await runScript(args, options);
  if (run.failure) return noReminderVerdict(run.failure);
  if (run.code === 2 || !run.out.trim()) return noReminderVerdict((run.err || `route.py exited ${run.code}`).trim().slice(-300));
  try {
    return parseReminderOutput(run.out);
  } catch (error) {
    return noReminderVerdict(`route.py output unreadable: ${(error as Error).message}`);
  }
}

/** Run a table subcommand (--list, --done, --undo) and return its JSON. */
export async function runReminderCommand(args: string[], options: ReminderRunOptions = {}):
  Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const run = await runScript([...args, "--json"], options);
  if (run.failure) return { ok: false, error: run.failure };
  try {
    return { ok: true, value: JSON.parse(run.out.trim()) as unknown };
  } catch {
    return { ok: false, error: (run.err || run.out || `route.py exited ${run.code}`).trim().slice(-300) };
  }
}

const WHEN = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", weekday: "short", day: "2-digit",
  month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/** "Fri 06 Nov 06:00" in Lisbon time; the raw text when it is not a date. */
export function formatDue(due: string | null | undefined): string {
  if (!due) return "?";
  const date = new Date(due);
  return Number.isNaN(date.getTime()) ? due : WHEN.format(date).replace(",", "");
}

/** True when the node wrote nothing because it was unsure, or a done message matched nothing. */
export function isReminderUnsure(verdict: ReminderVerdict): boolean {
  return verdict.routes.some((r) => r.status === "hint" || r.status === "downgraded" || r.status === "no-match");
}

export function reminderTraceLines(verdict: ReminderVerdict): string[] {
  if (!verdict.ok || verdict.abstained) return [`[reminder] no verdict: ${verdict.reason ?? "abstained"} - turn continues`];
  if (!verdict.routes.length) return ["[route] none - ordinary turn"];
  return verdict.routes.map((route) => {
    const bits = [route.note ?? route.error, route.seconds === undefined ? undefined : `${route.seconds} s`]
      .filter((bit): bit is string => !!bit);
    return `[route] ${route.destination.padEnd(20)} ${route.status}${bits.length ? `  ${bits.join(" · ")}` : ""}`;
  });
}

/** The whole reply for a turn the hook finishes itself. */
export function reminderOutcomeLines(verdict: ReminderVerdict): string[] {
  const done = verdict.routes.find((r) => r.destination === "do:reminder:done" || r.destination === "do:reminder:tasks-done");
  if (done) {
    if (done.status === "done" || done.status === "dry-run") {
      const extra = done.destination === "do:reminder:tasks-done" ? "Tasks" : `event ${done.eventAction ?? "none"}`;
      return [`→ done: ${done.title ?? done.id ?? "?"} (${done.id ?? "?"}, ${extra})`];
    }
    return [`→ not closed: ${done.note ?? done.status}`];
  }
  const task = verdict.routes.find((r) => r.destination === "do:reminder:tasks");
  if (task) {
    if (task.status === "created" || task.status === "dry-run") {
      return [`→ reminder: ${task.task?.title ?? task.note ?? "task"} (${task.task?.id ?? "?"})`,
        `  due ${formatDue(task.task?.due)}`, "  Google Tasks · Reminders"];
    }
    if (task.status === "skipped" && task.task?.id) {
      return [`→ reminder: ${task.task.title} (${task.task.id})`, "  already on Google Tasks"];
    }
    return [`→ not written: ${task.note ?? task.error ?? task.status}`];
  }
  const log = verdict.routes.find((r) => r.destination === "do:reminder:log");
  if (!log || log.status !== "logged" || !log.reminder) return [`→ not logged: ${log?.note ?? log?.error ?? log?.status ?? "nothing ran"}`];
  const lines = [`→ reminder: ${log.reminder.title} (${log.reminder.id})`, `  due ${formatDue(log.reminder.due)}`];
  const write = verdict.routes.find((r) => r.destination === "do:reminder:calendar");
  if (write?.status === "created" || write?.status === "dry-run") {
    if (write.event?.link) lines.push(`  ${write.event.link}`);
  } else if (write?.status === "skipped" && write.event?.id) {
    lines.push(`  already on the calendar (${write.event.id})`);
  } else {
    lines.push(`  no calendar event: ${write?.note ?? write?.error ?? write?.status ?? "the write did not run"}`);
  }
  return lines;
}

export function reminderTelegramReply(verdict: ReminderVerdict, withTrace: boolean): string {
  const lines = reminderOutcomeLines(verdict).map((line) => line.replace(/^→ /, ""));
  if (withTrace && verdict.confidence !== null) {
    lines.push("", `${verdict.winner ?? "?"} ${verdict.band ?? "?"} ${verdict.confidence.toFixed(3)}`);
  }
  return lines.join("\n");
}

/** The hidden block when the hook ran but Telegram delivery failed: relay, do not redo. */
export function reminderContextBlock(verdict: ReminderVerdict): string {
  return [
    "reminderNode - deterministic, already executed before this turn",
    ...verdict.routes.map((r) => `  ${r.destination} -> ${r.status}${r.note ? ` (${r.note})` : ""}`),
    "The reminder node has already run. Do not log the reminder, create its event, add a Google Task, or close it again,",
    "and do not add it to docs/INBOX.md. Relay this outcome in a few lines:",
    ...reminderOutcomeLines(verdict),
  ].join("\n");
}

/** The hidden block for an unsure verdict: nothing was written, ask first. */
export function reminderHintBlock(verdict: ReminderVerdict): string {
  const why = verdict.routes.find((r) => r.status === "hint" || r.status === "downgraded" || r.status === "no-match");
  const lines = ["reminderNode - unsure, nothing was written", `reason: ${why?.note ?? "low confidence"}`];
  if (why?.destination === "do:reminder:done" || why?.destination === "do:reminder:tasks-done" || why?.destination === "hint:reminder_done") {
    lines.push("This message may say a reminder is done. Do not edit the reminders table or Google Tasks yourself.",
      "If it is a store reminder, ask which one, then tell the user to run /reminder-done <id>.",
      "If it is a Google Task, ask which one, then tell the user to name it again or ask tasks-agent.");
    for (const p of why.pending ?? []) lines.push(`  pending ${p.id}: ${p.title} (due ${formatDue(p.due)})`);
  } else {
    lines.push("This message may ask for a reminder. Do not create one yourself, and do not add it to docs/INBOX.md.",
      "If it is a reminder request, ask the user to confirm it in one line; otherwise answer normally.");
  }
  return lines.join("\n");
}

/** The /reminders table. */
export function formatReminderTable(rows: ReminderRow[]): string {
  if (!rows.length) return "no reminders";
  const lines = [`${"id".padEnd(16)} ${"status".padEnd(8)} ${"due".padEnd(17)} title`];
  for (const row of rows) {
    lines.push(`${row.id.padEnd(16)} ${row.status.padEnd(8)} ${formatDue(row.due).padEnd(17)} ${row.title ?? ""}`);
  }
  return lines.join("\n");
}
