/**
 * Cron Extension for Pi
 *
 * Scheduled job execution inside the Pi agent harness.
 *
 * Features:
 * - Schedule types: at (one-shot), every (interval), cron (expression)
 * - Payload types: agentTurn (spawn pi --print), systemEvent (log)
 * - Timer capped at 60s max delay for system-sleep recovery
 * - JSON file persistence (~/.pi/cron/jobs.json)
 * - Run history as JSONL (~/.pi/cron/runs/<jobId>.jsonl)
 * - /cron management command
 * - cron tool for the agent to schedule its own jobs
 *
 * Placement: ~/.pi/agent/cos-orchestrator-agent/extensions/cron.ts
 * The engine stays at ~/.pi/cron/ (three levels up from this file).
 */

import * as child_process from "node:child_process";
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { normalizeCronJobCreate, normalizeCronJobPatch } from "../../../cron/normalize.ts";
import { computeNextRunAtMs, MAX_TIMER_DELAY_MS, computeTimerDelay } from "../../../cron/schedule.ts";
import {
  loadStore,
  saveStore,
  persistJob,
  removeJobFromStore,
  appendRunLog,
  getRunHistory,
  generateJobId,
  generateRunId,
} from "../../../cron/store.ts";
import type { CronJob, CronStoreFile, CronRunEntry } from "../../../cron/types.ts";

// ── State ──

let store: CronStoreFile;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let piExtensionApi: ExtensionAPI | null = null;

// ── Helpers ──

function nowMs(): number {
  return Date.now();
}

function getPiPath(): string {
  // Use the same pi binary that's running this extension
  return process.argv[1] || "pi";
}

function formatJobList(jobs: CronJob[]): string[] {
  if (jobs.length === 0) return ["No cron jobs."];
  const lines: string[] = [];
  for (const job of jobs) {
    const status = job.enabled ? "✓" : "✗";
    const nextRun = job.state.nextRunAtMs
      ? new Date(job.state.nextRunAtMs).toLocaleString()
      : "—";
    const lastStatus = job.state.lastRunStatus ?? "—";
    lines.push(
      `  ${status} ${job.id.slice(0, 10)}…  ${job.name}  next: ${nextRun}  last: ${lastStatus}`
    );
  }
  return lines;
}

function formatJobDetail(job: CronJob): string[] {
  return [
    `Job: ${job.name}`,
    `ID: ${job.id}`,
    `Enabled: ${job.enabled}`,
    `Schedule: ${job.schedule.kind} — ${
      job.schedule.kind === "at"
        ? job.schedule.at
        : job.schedule.kind === "every"
          ? `${job.schedule.everyMs}ms`
          : `${job.schedule.expr}${job.schedule.tz ? ` (${job.schedule.tz})` : ""}`
    }`,
    `Payload: ${job.payload.kind}`,
    `Delivery: ${job.delivery?.mode ?? "log"}`,
    `Delete after run: ${job.deleteAfterRun ?? false}`,
    `Next run: ${job.state.nextRunAtMs ? new Date(job.state.nextRunAtMs).toLocaleString() : "—"}`,
    `Last run: ${job.state.lastRunAtMs ? new Date(job.state.lastRunAtMs).toLocaleString() : "—"}`,
    `Last status: ${job.state.lastRunStatus ?? "—"}`,
    job.state.lastError ? `Last error: ${job.state.lastError}` : "",
    `Created: ${new Date(job.createdAtMs).toLocaleString()}`,
  ].filter(Boolean);
}

// ── Execution ──

async function executeAgentTurnJob(job: CronJob): Promise<{ status: "ok" | "error"; output?: string; error?: string }> {
  const payload = job.payload;
  if (payload.kind !== "agentTurn") {
    return { status: "ok", output: "System event recorded." };
  }

  const piPath = getPiPath();
  const args: string[] = [
    "--print",
    "--no-session",
    `--name`, `cron:${job.name}`,
  ];

  if (payload.model) args.push("--model", payload.model);
  if (payload.thinking) args.push("--thinking", payload.thinking);

  // Add the message as the prompt
  args.push(payload.message);

  return new Promise((resolve) => {
    const child = child_process.spawn(piPath, args, {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: (payload.timeoutSeconds ?? 300) * 1000, // default 5 min
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString("utf-8");
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString("utf-8");
    });

    child.on("close", (code) => {
      const output = stdout.trim() || stderr.trim();
      if (code === 0) {
        resolve({ status: "ok", output });
      } else {
        resolve({
          status: "error",
          output,
          error: stderr.trim() || `Exit code ${code}`,
        });
      }
    });

    child.on("error", (err) => {
      resolve({ status: "error", error: err.message });
    });
  });
}

async function executeJob(job: CronJob): Promise<void> {
  const runId = generateRunId();
  const startedAt = nowMs();

  job.state.runningAtMs = startedAt;
  persistJob(job, store);

  let result: { status: "ok" | "error"; output?: string; error?: string };

  try {
    result = await executeAgentTurnJob(job);
  } catch (err: any) {
    result = { status: "error", error: err?.message ?? "Unknown error" };
  }

  const finishedAt = nowMs();
  const durationMs = finishedAt - startedAt;

  // Update job state
  job.state.runningAtMs = undefined;
  job.state.lastRunAtMs = finishedAt;
  job.state.lastRunStatus = result.status;
  job.state.lastError = result.error;
  job.state.lastDurationMs = durationMs;

  if (result.status === "error") {
    job.state.consecutiveErrors = (job.state.consecutiveErrors ?? 0) + 1;
  } else {
    job.state.consecutiveErrors = 0;
  }

  // Append run log
  const entry: CronRunEntry = {
    runId,
    jobId: job.id,
    startedAtMs: startedAt,
    finishedAtMs: finishedAt,
    status: result.status,
    error: result.error,
    output: result.output,
    durationMs,
  };
  appendRunLog(entry);

  // Handle one-shot auto-delete
  if (result.status === "ok" && job.deleteAfterRun) {
    removeJobFromStore(job.id, store);
    return;
  }

  // Recompute next run and persist
  const next = computeNextRunAtMs(job.schedule, nowMs());
  job.state.nextRunAtMs = next;
  persistJob(job, store);
}

// ── Timer ──

function recomputeAllNextRuns(): void {
  const n = nowMs();
  for (const job of store.jobs) {
    if (!job.enabled || job.state.runningAtMs) continue;
    if (job.schedule.kind === "at" && job.state.lastRunAtMs && job.state.lastRunStatus === "ok") {
      // One-shot that already ran successfully
      job.state.nextRunAtMs = undefined;
      continue;
    }
    job.state.nextRunAtMs = computeNextRunAtMs(job.schedule, n);
  }
}

function armTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  const n = nowMs();

  // Find the nearest upcoming job
  let nearestMs: number | undefined;
  for (const job of store.jobs) {
    if (!job.enabled || !job.state.nextRunAtMs) continue;
    if (!nearestMs || job.state.nextRunAtMs < nearestMs) {
      nearestMs = job.state.nextRunAtMs;
    }
  }

  if (!nearestMs) return;

  const delay = computeTimerDelay(nearestMs, n);

  timer = setTimeout(async () => {
    await onTimer();
  }, delay);

  // Allow the process to exit if this is the only thing keeping it alive.
  // In interactive/TUI mode, the TUI event loop keeps the process alive anyway.
  timer.unref();
}

async function onTimer(): Promise<void> {
  if (running) {
    armTimer();
    return;
  }

  running = true;
  const n = nowMs();

  try {
    // Find all jobs that are due
    const dueJobs = store.jobs.filter(
      (j) =>
        j.enabled &&
        !j.state.runningAtMs &&
        j.state.nextRunAtMs != null &&
        j.state.nextRunAtMs <= n
    );

    for (const job of dueJobs) {
      await executeJob(job);
    }

    // Recompute next runs for remaining jobs that might need recalculation
    recomputeAllNextRuns();
    saveStore(store);
  } finally {
    running = false;
    armTimer();
  }
}

// ── Status helper ──

function cronStatus() {
  return {
    enabled: true,
    jobCount: store.jobs.length,
    enabledJobCount: store.jobs.filter((j) => j.enabled).length,
    timerActive: timer !== null,
    running,
  };
}

// ── Pi Extension Entry Point ──

export default function (pi: ExtensionAPI) {
  piExtensionApi = pi;

  // ── Startup: load store, clear stale markers, arm timer ──

  store = loadStore();

  // Clear stale running markers (from previous crash)
  for (const job of store.jobs) {
    if (job.state.runningAtMs) {
      job.state.runningAtMs = undefined;
    }
  }

  // Recompute next runs and arm timer
  recomputeAllNextRuns();
  saveStore(store);
  armTimer();

  pi.on("session_start", async (_event, ctx) => {
    const enabledJobs = store.jobs.filter((j) => j.enabled).length;
    if (enabledJobs > 0) {
      ctx.ui.notify(`Cron: ${enabledJobs} active job${enabledJobs !== 1 ? "s" : ""}`, "info");
    }
  });

  // ── /cron command ──

  pi.registerCommand("cron", {
    description: "Manage cron jobs",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/cron requires interactive mode", "error");
        return;
      }
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase();
      const rest = parts.slice(1).join(" ");

      switch (sub) {
        case "status":
        case "": {
          const s = cronStatus();
          ctx.ui.notify(
            `Cron active. ${s.enabledJobCount}/${s.jobCount} jobs enabled. Timer: ${s.timerActive ? "armed" : "idle"}.`,
            "info"
          );
          break;
        }

        case "list": {
          const items = formatJobList(store.jobs);
          if (items.length === 1 && items[0] === "No cron jobs.") {
            ctx.ui.notify("No cron jobs.", "info");
          } else {
            // Show as select so user can scroll
            const selected = await ctx.ui.select("Cron Jobs", items);
            if (selected) {
              // Extract job ID from the selection line
              const idMatch = selected.match(/^\s*[✓✗]\s+(\S+)/);
              if (idMatch) {
                const prefix = idMatch[1].replace("…", "");
                const job = store.jobs.find((j) => j.id.startsWith(prefix));
                if (job) {
                  await ctx.ui.select(job.name, formatJobDetail(job));
                }
              }
            }
          }
          break;
        }

        case "add": {
          // Interactive job creation
          const name = await ctx.ui.input("Job name:");
          if (!name) return;

          const scheduleKind = await ctx.ui.select("Schedule type:", ["at (one-shot)", "every (interval)", "cron (expression)"]);
          if (!scheduleKind) return;

          let scheduleInput: string | undefined = "";
          if (scheduleKind.startsWith("at")) {
            scheduleInput = await ctx.ui.input("Time (ISO-8601 or relative like '20m', '1h'):");
          } else if (scheduleKind.startsWith("every")) {
            scheduleInput = await ctx.ui.input("Interval (e.g. '1h', '30m', '1d', or ms like '3600000'):");
          } else {
            scheduleInput = await ctx.ui.input("Cron expression (e.g. '0 7 * * *'):");
          }
          if (!scheduleInput) return;

          const message = await ctx.ui.input("Agent prompt:");
          if (!message) return;

          try {
            const schedule = parseScheduleInput(scheduleKind, scheduleInput);
            const job = normalizeCronJobCreate(
              {
                name,
                schedule,
                payload: { kind: "agentTurn", message },
                enabled: true,
              },
              generateJobId()
            );

            job.state.nextRunAtMs = computeNextRunAtMs(job.schedule, nowMs());
            persistJob(job, store);
            recomputeAllNextRuns();
            armTimer();

            ctx.ui.notify(`Job created: ${job.id.slice(0, 10)}… "${job.name}"`, "info");
          } catch (err: any) {
            ctx.ui.notify(`Error: ${err.message}`, "error");
          }
          break;
        }

        case "enable": {
          const jobId = rest.trim();
          if (!jobId) {
            ctx.ui.notify("Usage: /cron enable <job-id-prefix>", "error");
            return;
          }
          const job = findJobByPrefix(jobId);
          if (!job) {
            ctx.ui.notify(`Job not found: ${jobId}`, "error");
            return;
          }
          job.enabled = true;
          job.state.nextRunAtMs = computeNextRunAtMs(job.schedule, nowMs());
          persistJob(job, store);
          recomputeAllNextRuns();
          armTimer();
          ctx.ui.notify(`Enabled: ${job.name}`, "info");
          break;
        }

        case "disable": {
          const jobId = rest.trim();
          if (!jobId) {
            ctx.ui.notify("Usage: /cron disable <job-id-prefix>", "error");
            return;
          }
          const job = findJobByPrefix(jobId);
          if (!job) {
            ctx.ui.notify(`Job not found: ${jobId}`, "error");
            return;
          }
          job.enabled = false;
          persistJob(job, store);
          ctx.ui.notify(`Disabled: ${job.name}`, "info");
          break;
        }

        case "remove": {
          const jobId = rest.trim();
          if (!jobId) {
            ctx.ui.notify("Usage: /cron remove <job-id-prefix>", "error");
            return;
          }
          const job = findJobByPrefix(jobId);
          if (!job) {
            ctx.ui.notify(`Job not found: ${jobId}`, "error");
            return;
          }
          const ok = await ctx.ui.confirm("Remove job?", `Delete "${job.name}"?`);
          if (ok) {
            removeJobFromStore(job.id, store);
            ctx.ui.notify(`Removed: ${job.name}`, "info");
          }
          break;
        }

        case "run": {
          const jobId = rest.trim();
          if (!jobId) {
            ctx.ui.notify("Usage: /cron run <job-id-prefix>", "error");
            return;
          }
          const job = findJobByPrefix(jobId);
          if (!job) {
            ctx.ui.notify(`Job not found: ${jobId}`, "error");
            return;
          }
          ctx.ui.notify(`Running: ${job.name}…`, "info");
          await executeJob(job);
          recomputeAllNextRuns();
          saveStore(store);
          armTimer();
          ctx.ui.notify(
            `Done: ${job.name} — ${job.state.lastRunStatus ?? "?"}`,
            job.state.lastRunStatus === "ok" ? "info" : "error"
          );
          break;
        }

        case "runs": {
          const jobId = rest.trim();
          if (!jobId) {
            ctx.ui.notify("Usage: /cron runs <job-id-prefix>", "error");
            return;
          }
          const job = findJobByPrefix(jobId);
          if (!job) {
            ctx.ui.notify(`Job not found: ${jobId}`, "error");
            return;
          }
          const runs = getRunHistory(job.id, 20);
          if (runs.length === 0) {
            ctx.ui.notify(`No runs for: ${job.name}`, "info");
          } else {
            const lines = runs.map((r) => {
              const time = new Date(r.finishedAtMs).toLocaleString();
              const dur = `${(r.durationMs / 1000).toFixed(1)}s`;
              const out = r.output ? r.output.slice(0, 100).replace(/\n/g, " ") : "";
              return `${r.status === "ok" ? "✓" : "✗"} ${time} (${dur}) ${out}${r.error ? ` — ${r.error}` : ""}`;
            });
            await ctx.ui.select(`Runs: ${job.name}`, lines);
          }
          break;
        }

        default:
          ctx.ui.notify(
            "Usage: /cron [status|list|add|enable|disable|remove|run|runs]",
            "error"
          );
      }
    },
  });

  // ── cron tool (for the agent) ──

  pi.registerTool({
    name: "cron",
    label: "Cron",
    description: `Manage scheduled jobs. The cron scheduler runs inside Pi and can execute agent turns on a schedule.

ACTIONS:
- status: get scheduler status
- list: list all jobs (compact summary)
- get: get full job details by jobId
- add: create a new cron job
- update: edit an existing job by jobId
- remove: delete a job by jobId
- run: force-run a job now by jobId
- runs: view run history for a job by jobId

ADD JOB:
{ "name":"My Job", "schedule":{...}, "payload":{...}, "enabled":true, "description":"..." }

SCHEDULE types:
- at: { "kind":"at", "at":"2027-03-01T09:00:00Z" } or relative "20m", "1h", "1d"
- every: { "kind":"every", "everyMs":3600000 } (ms)
- cron: { "kind":"cron", "expr":"0 7 * * *", "tz":"Europe/Lisbon" } (local wall-clock time)

PAYLOAD types:
- agentTurn: { "kind":"agentTurn", "message":"Your prompt here", "model?":"...", "thinking?":"..." }
- systemEvent: { "kind":"systemEvent", "text":"Event text" }

Use agentTurn for scheduled agent work. The cron scheduler spawns a fresh pi --print process for each run.`,
    parameters: Type.Object({
      action: Type.String({
        description: "Action: status, list, get, add, update, remove, run, runs",
      }),
      jobId: Type.Optional(Type.String({ description: "Job ID (prefix OK for get/update/remove/run/runs)" })),
      job: Type.Optional(
        Type.Object({
          name: Type.Optional(Type.String({ description: "Job name" })),
          schedule: Type.Optional(
            Type.Object({
              kind: Type.Optional(Type.String({ description: "at, every, or cron" })),
              at: Type.Optional(Type.String({ description: "ISO-8601 time or relative like '20m' (kind=at)" })),
              everyMs: Type.Optional(Type.Number({ description: "Interval in ms (kind=every)" })),
              anchorMs: Type.Optional(Type.Number({ description: "Anchor start ms (kind=every)" })),
              expr: Type.Optional(Type.String({ description: 'Cron expression (kind=cron). Wall-clock time; never UTC-convert. Example "0 7 * * *"' })),
              tz: Type.Optional(Type.String({ description: 'IANA timezone. Missing = host local. Example "Europe/Lisbon"' })),
            })
          ),
          payload: Type.Optional(
            Type.Object({
              kind: Type.Optional(Type.String({ description: "agentTurn or systemEvent" })),
              message: Type.Optional(Type.String({ description: "Agent prompt (kind=agentTurn)" })),
              text: Type.Optional(Type.String({ description: "System event text (kind=systemEvent)" })),
              model: Type.Optional(Type.String({ description: "Model override" })),
              thinking: Type.Optional(Type.String({ description: "Thinking level override" })),
              timeoutSeconds: Type.Optional(Type.Number({ description: "Timeout in seconds" })),
            })
          ),
          enabled: Type.Optional(Type.Boolean({ description: "Enable the job (default true)" })),
          deleteAfterRun: Type.Optional(Type.Boolean({ description: "Delete after first successful run" })),
          description: Type.Optional(Type.String({ description: "Human description" })),
        })
      ),
      patch: Type.Optional(
        Type.Object({
          name: Type.Optional(Type.String()),
          schedule: Type.Optional(Type.Any()),
          payload: Type.Optional(Type.Any()),
          enabled: Type.Optional(Type.Boolean()),
          deleteAfterRun: Type.Optional(Type.Boolean()),
          description: Type.Optional(Type.String()),
        })
      ),
    }),
    async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
      const action = params.action as string;
      const jobId = (params.jobId as string)?.trim();

      try {
        switch (action) {
          case "status":
            return {
              content: [{ type: "text" as const, text: JSON.stringify(cronStatus(), null, 2) }],
              details: cronStatus(),
            };

          case "list": {
            const jobs = store.jobs.map((j) => ({
              id: j.id,
              name: j.name,
              enabled: j.enabled,
              nextRunAtMs: j.state.nextRunAtMs,
              scheduleKind: j.schedule.kind,
              lastRunStatus: j.state.lastRunStatus,
            }));
            return {
              content: [{ type: "text" as const, text: JSON.stringify(jobs, null, 2) }],
              details: { jobs, total: jobs.length },
            };
          }

          case "get": {
            const job = jobId ? findJobByPrefix(jobId) : null;
            if (!job) return errorResult(`Job not found: ${jobId}`);
            return {
              content: [{ type: "text" as const, text: JSON.stringify(job, null, 2) }],
              details: job,
            };
          }

          case "add": {
            const jobInput = params.job as Record<string, unknown> | undefined;
            if (!jobInput) return errorResult("job is required for add action");
            const id = generateJobId();
            const job = normalizeCronJobCreate(jobInput, id);
            job.state.nextRunAtMs = computeNextRunAtMs(job.schedule, nowMs());
            persistJob(job, store);
            recomputeAllNextRuns();
            armTimer();
            return {
              content: [{ type: "text" as const, text: `Job created: ${id} — "${job.name}"` }],
              details: { id, name: job.name },
            };
          }

          case "update": {
            if (!jobId) return errorResult("jobId is required for update action");
            const job = findJobByPrefix(jobId);
            if (!job) return errorResult(`Job not found: ${jobId}`);
            const patch = params.patch as Record<string, unknown> | undefined;
            if (!patch) return errorResult("patch is required for update action");
            const normalized = normalizeCronJobPatch(patch);
            Object.assign(job, normalized);
            if (patch.schedule || patch.enabled !== undefined) {
              job.state.nextRunAtMs = job.enabled
                ? computeNextRunAtMs(job.schedule, nowMs())
                : undefined;
            }
            persistJob(job, store);
            recomputeAllNextRuns();
            armTimer();
            return {
              content: [{ type: "text" as const, text: `Job updated: ${job.id} — "${job.name}"` }],
              details: { id: job.id, name: job.name },
            };
          }

          case "remove": {
            if (!jobId) return errorResult("jobId is required for remove action");
            const job = findJobByPrefix(jobId);
            if (!job) return errorResult(`Job not found: ${jobId}`);
            removeJobFromStore(job.id, store);
            return {
              content: [{ type: "text" as const, text: `Job removed: ${job.id} — "${job.name}"` }],
              details: { id: job.id, name: job.name },
            };
          }

          case "run": {
            if (!jobId) return errorResult("jobId is required for run action");
            const job = findJobByPrefix(jobId);
            if (!job) return errorResult(`Job not found: ${jobId}`);
            await executeJob(job);
            recomputeAllNextRuns();
            saveStore(store);
            armTimer();
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Run complete: ${job.name} — ${job.state.lastRunStatus}${job.state.lastError ? ` (${job.state.lastError})` : ""}`,
                },
              ],
              details: {
                status: job.state.lastRunStatus,
                durationMs: job.state.lastDurationMs,
              },
            };
          }

          case "runs": {
            if (!jobId) return errorResult("jobId is required for runs action");
            const job = findJobByPrefix(jobId);
            if (!job) return errorResult(`Job not found: ${jobId}`);
            const runs = getRunHistory(job.id, 20);
            return {
              content: [{ type: "text" as const, text: JSON.stringify(runs, null, 2) }],
              details: { jobId: job.id, entries: runs, count: runs.length },
            };
          }

          default:
            return errorResult(`Unknown action: ${action}. Valid: status, list, get, add, update, remove, run, runs`);
        }
      } catch (err: any) {
        return errorResult(`Cron error: ${err.message}`);
      }
    },
  });

  // ── Shutdown: clear timer ──
  // pi 1.5 renamed this hook: "session_end" is no longer emitted, so the old
  // registration was a silent no-op.

  pi.on("session_shutdown", async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  });
}

// ── Helper functions (module-level) ──

function findJobByPrefix(prefix: string): CronJob | undefined {
  return store.jobs.find((j) => j.id.startsWith(prefix));
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: { error: message },
  };
}

function parseScheduleInput(kind: string, input: string): Record<string, unknown> {
  if (kind.startsWith("at")) {
    return { kind: "at", at: input.trim() };
  }
  if (kind.startsWith("every")) {
    const ms = parseIntervalMs(input.trim());
    return { kind: "every", everyMs: ms };
  }
  return { kind: "cron", expr: input.trim() };
}

function parseIntervalMs(input: string): number {
  // Parse intervals like "1h", "30m", "1d", or plain ms
  const relMatch = input.match(/^(\d+)\s*(s|m|h|d)$/i);
  if (relMatch) {
    const val = parseInt(relMatch[1], 10);
    switch (relMatch[2].toLowerCase()) {
      case "s": return val * 1000;
      case "m": return val * 60_000;
      case "h": return val * 60 * 60_000;
      case "d": return val * 24 * 60 * 60_000;
    }
  }
  const num = parseInt(input, 10);
  if (Number.isFinite(num) && num > 0) return num;
  throw new Error(`Invalid interval: ${input}`);
}

// Re-export for external usage
export { cronStatus, loadStore, executeJob, store };