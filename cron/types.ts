// ── Schedule types ──

export type CronSchedule =
  | { kind: "at"; at: string }                          // ISO-8601 or relative like "20m"
  | { kind: "every"; everyMs: number; anchorMs?: number } // Fixed interval
  | { kind: "cron"; expr: string; tz?: string };         // Cron expression, default tz=host

// ── Payload types ──

export type CronPayload =
  | { kind: "systemEvent"; text: string }
  | { kind: "agentTurn"; message: string; model?: string; thinking?: string; timeoutSeconds?: number };

// ── Delivery ──

export type CronDeliveryMode = "none" | "log";

export type CronDelivery = {
  mode: CronDeliveryMode;
};

// ── Runtime state (mutable, persisted alongside the job) ──

export type CronJobState = {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
};

// ── The full cron job ──

export type CronJob = {
  id: string;
  name: string;                           // Required short name
  schedule: CronSchedule;
  payload: CronPayload;
  delivery?: CronDelivery;
  enabled: boolean;
  deleteAfterRun?: boolean;               // Auto-delete after first success (at jobs)
  description?: string;
  createdAtMs: number;
  updatedAtMs: number;
  state: CronJobState;
};

// ── Store file ──

export type CronStoreFile = {
  version: 1;
  jobs: CronJob[];
};

// ── Run log entry ──

export type CronRunEntry = {
  runId: string;
  jobId: string;
  startedAtMs: number;
  finishedAtMs: number;
  status: "ok" | "error" | "skipped";
  error?: string;
  output?: string;
  durationMs: number;
};