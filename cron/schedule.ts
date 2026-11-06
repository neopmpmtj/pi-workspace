import type { CronSchedule } from "./types.ts";

// ── Relative time parsing ──

const RELATIVE_RE = /^(\d+)\s*(s|m|h|d)$/i;

function parseRelativeTime(raw: string): number | null {
  const match = raw.trim().match(RELATIVE_RE);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const now = Date.now();
  switch (unit) {
    case "s": return now + value * 1000;
    case "m": return now + value * 60_000;
    case "h": return now + value * 60 * 60_000;
    case "d": return now + value * 24 * 60 * 60_000;
    default: return null;
  }
}

// ── Absolute time parsing ──

function parseAbsoluteTime(input: string): number | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

// ── Timezone utilities ──

interface LocalTime {
  year: number;
  month: number;   // 1-12
  day: number;      // 1-31
  hour: number;     // 0-23
  minute: number;   // 0-59
  second: number;   // 0-59
  dow: number;      // 0=Sun .. 6=Sat
}

const DOW_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Extract local time components from a UTC timestamp for a given IANA timezone.
 */
function utcToLocal(utcMs: number, tz: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(new Date(utcMs));

  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
    dow: DOW_MAP[weekday] ?? 0,
  };
}

/**
 * Convert a local wall-clock time in a given IANA timezone to a UTC timestamp.
 *
 * Iteratively converges: start from a naive guess (components as UTC),
 * compute the actual local time at that guess, adjust by the difference,
 * and repeat.  Handles DST transitions because each iteration recomputes
 * the timezone offset at the current guess.
 */
function localToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): number {
  // Start: treat the target local components as if they were UTC
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  for (let i = 0; i < 5; i++) {
    const local = utcToLocal(guess, tz);
    if (
      local.year === year &&
      local.month === month &&
      local.day === day &&
      local.hour === hour &&
      local.minute === minute
    ) {
      return guess;
    }
    // How many minutes is our guess off from the target local time?
    const gotMinutes = local.hour * 60 + local.minute;
    const wantMinutes = hour * 60 + minute;
    const deltaMin = wantMinutes - gotMinutes;
    guess += deltaMin * 60_000;
  }

  return guess;
}

// ── Cron field parser ──

function parseCronField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  const parts = field.split(",");
  for (const part of parts) {
    if (part === "*") {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (part.includes("/")) {
      const [range, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      if (range === "*") {
        for (let i = min; i <= max; i += step) values.add(i);
      } else {
        const [rMin, rMax] = range.split("-").map(Number);
        for (let i = rMin; i <= (rMax || max); i += step) values.add(i);
      }
    } else if (part.includes("-")) {
      const [rMin, rMax] = part.split("-").map(Number);
      for (let i = rMin; i <= rMax; i++) values.add(i);
    } else {
      values.add(parseInt(part, 10));
    }
  }
  return values;
}

// ── Days in month ──

function daysInMonth(year: number, month: number): number {
  // month is 1-12
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ── Cron time computation with timezone ──

function nextCronTime(expr: string, afterMs: number, tz: string): number | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length < 5) return null;

  const [minField, hourField, domField, monthField, dowField] = fields;

  const minutes = parseCronField(minField, 0, 59);
  const hours = parseCronField(hourField, 0, 23);
  const daysOfMonth = parseCronField(domField, 1, 31);
  const months = parseCronField(monthField, 1, 12);
  const daysOfWeek = parseCronField(dowField, 0, 6);

  // Start checking from 1 minute after the reference time
  // Convert to local time in the target timezone
  const startLocal = utcToLocal(afterMs + 60_000, tz);

  let y = startLocal.year;
  let m = startLocal.month;     // 1-12
  let d = startLocal.day;       // 1-31
  let h = startLocal.hour;      // 0-23
  let min = startLocal.minute;  // 0-59

  // Safety: check up to ~2 years ahead
  const maxAttempts = 1_100_000; // ~2 years in minutes

  for (let attempts = 0; attempts < maxAttempts; attempts++) {
    // Validate day exists in this month
    const maxDay = daysInMonth(y, m);
    if (d > maxDay) {
      // Overflow to next month
      d = 1;
      m++;
      if (m > 12) { m = 1; y++; }
      continue;
    }

    // Compute day-of-week for this candidate
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    // Check if all fields match
    if (minutes.has(min) && hours.has(h) && months.has(m)) {
      const domMatch = daysOfMonth.has(d);
      const dowMatch = daysOfWeek.has(dow);
      if (domMatch || dowMatch) {
        // Convert local wall-clock time to UTC
        return localToUtc(y, m, d, h, min, tz);
      }
    }

    // Advance one minute in local wall-clock time
    min++;
    if (min > 59) {
      min = 0;
      h++;
    }
    if (h > 23) {
      h = 0;
      d++;
    }
    if (d > maxDay) {
      d = 1;
      m++;
    }
    if (m > 12) {
      m = 1;
      y++;
    }
  }

  return null;
}

// ── Main scheduling function ──

export function computeNextRunAtMs(
  schedule: CronSchedule,
  nowMs: number,
): number | undefined {
  if (schedule.kind === "at") {
    let atMs: number | null;
    const relative = parseRelativeTime(schedule.at);
    if (relative !== null) {
      atMs = relative;
    } else {
      atMs = parseAbsoluteTime(schedule.at);
    }
    return atMs !== null && atMs > nowMs ? atMs : undefined;
  }

  if (schedule.kind === "every") {
    const everyMs = Math.max(1, Math.floor(schedule.everyMs));
    const anchor = Math.max(0, Math.floor(schedule.anchorMs ?? nowMs));
    if (nowMs < anchor) return anchor;
    const elapsed = nowMs - anchor;
    const steps = Math.max(1, Math.floor((elapsed + everyMs - 1) / everyMs));
    return anchor + steps * everyMs;
  }

  if (schedule.kind === "cron") {
    const tz = schedule.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
    return nextCronTime(schedule.expr, nowMs, tz) ?? undefined;
  }

  return undefined;
}

// ── Timer (capped at 60s max delay for system-sleep recovery) ──

export const MAX_TIMER_DELAY_MS = 60_000;

export function computeTimerDelay(nextRunAtMs: number, nowMs: number): number {
  const delay = Math.max(0, nextRunAtMs - nowMs);
  return Math.min(delay, MAX_TIMER_DELAY_MS);
}
