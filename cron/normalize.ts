/**
 * Normalize LLM-generated cron job input.
 * Handles: case correction, legacy field names, missing defaults, and type coercion.
 */
import type { CronJob, CronJobState, CronPayload, CronSchedule } from "./types";

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── Schedule normalization ──

function normalizeSchedule(raw: UnknownRecord): CronSchedule {
  const kind = typeof raw.kind === "string" ? raw.kind.trim().toLowerCase() : "";
  const at = typeof raw.at === "string" ? raw.at.trim() : undefined;
  const everyMs = typeof raw.everyMs === "number" ? raw.everyMs : undefined;
  const anchorMs = typeof raw.anchorMs === "number" ? raw.anchorMs : undefined;
  const expr = typeof raw.expr === "string" ? raw.expr.trim() : undefined;
  const tz = typeof raw.tz === "string" ? raw.tz.trim() : undefined;

  if (kind === "at" && at) return { kind: "at", at };
  if (kind === "every" && everyMs) return { kind: "every", everyMs, ...(anchorMs ? { anchorMs } : {}) };
  if (kind === "cron" && expr) return { kind: "cron", expr, ...(tz ? { tz } : {}) };

  // Auto-infer kind
  if (at) return { kind: "at", at };
  if (typeof everyMs === "number") return { kind: "every", everyMs, ...(anchorMs ? { anchorMs } : {}) };
  if (expr) return { kind: "cron", expr, ...(tz ? { tz } : {}) };

  // Fallback
  throw new Error("Invalid schedule: must have kind + relevant fields");
}

// ── Payload normalization ──

function normalizePayload(raw: UnknownRecord): CronPayload {
  const kindRaw = typeof raw.kind === "string" ? raw.kind.trim().toLowerCase() : "";

  // Fix casing
  let kind = kindRaw;
  if (kindRaw === "agentturn") kind = "agentTurn";
  if (kindRaw === "systemevent") kind = "systemEvent";

  const text = typeof raw.text === "string" ? raw.text.trim() : undefined;
  const message = typeof raw.message === "string" ? raw.message.trim() : undefined;

  // Auto-infer kind
  if (!kind) {
    if (message) kind = "agentTurn";
    else if (text) kind = "systemEvent";
    else kind = "systemEvent"; // default
  }

  if (kind === "agentTurn") {
    return {
      kind: "agentTurn",
      message: message || text || "No message provided",
      ...(typeof raw.model === "string" && raw.model.trim()
        ? { model: raw.model.trim() }
        : {}),
      ...(typeof raw.thinking === "string" && raw.thinking.trim()
        ? { thinking: raw.thinking.trim() }
        : {}),
      ...(typeof raw.timeoutSeconds === "number" && raw.timeoutSeconds > 0
        ? { timeoutSeconds: raw.timeoutSeconds }
        : {}),
    };
  }

  return { kind: "systemEvent", text: text || "No text provided" };
}

// ── Delivery normalization ──

function normalizeDelivery(raw: UnknownRecord | undefined): { mode: "none" | "log" } {
  if (!raw) return { mode: "log" };
  const mode: string = typeof raw.mode === "string" ? raw.mode.trim().toLowerCase() : "";
  if (mode === "none") return { mode: "none" };
  return { mode: "log" };
}

// ── Main normalization for job creation ──

export function normalizeCronJobCreate(input: UnknownRecord, jobId: string): CronJob {
  const now = Date.now();

  const schedule = isRecord(input.schedule)
    ? normalizeSchedule(input.schedule)
    : (() => { throw new Error("schedule is required"); })();

  const payload = isRecord(input.payload)
    ? normalizePayload(input.payload)
    : (() => { throw new Error("payload is required"); })();

  const delivery = isRecord(input.delivery) ? normalizeDelivery(input.delivery) : { mode: "log" as const };

  const state: CronJobState = {};

  return {
    id: jobId,
    name: typeof input.name === "string" && input.name.trim()
      ? input.name.trim()
      : `Unnamed job`,
    schedule,
    payload,
    delivery,
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    deleteAfterRun: typeof input.deleteAfterRun === "boolean" ? input.deleteAfterRun : schedule.kind === "at",
    description: typeof input.description === "string" ? input.description.trim() : undefined,
    createdAtMs: now,
    updatedAtMs: now,
    state,
  };
}

// ── Normalization for job patches ──

export function normalizeCronJobPatch(raw: UnknownRecord): Partial<CronJob> {
  const patch: Partial<CronJob> & { state?: Partial<CronJobState> } = {
    updatedAtMs: Date.now(),
  };

  if (typeof raw.name === "string" && raw.name.trim()) patch.name = raw.name.trim();
  if (isRecord(raw.schedule)) patch.schedule = normalizeSchedule(raw.schedule);
  if (isRecord(raw.payload)) patch.payload = normalizePayload(raw.payload);
  if (isRecord(raw.delivery)) patch.delivery = normalizeDelivery(raw.delivery);
  if (typeof raw.enabled === "boolean") patch.enabled = raw.enabled;
  if (typeof raw.deleteAfterRun === "boolean") patch.deleteAfterRun = raw.deleteAfterRun;
  if (typeof raw.description === "string") patch.description = raw.description.trim();

  return patch;
}