import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { CronJob, CronStoreFile, CronRunEntry } from "./types.ts";

// The store lives beside this engine, wherever the engine sits. Deriving it from the
// module's own location (instead of hoping PI_CODING_AGENT_DIR is exactly one level
// below ~/.pi) keeps jobs and run history stable when the agent home moves: with the
// 2026-11-06 rename the home gained a level, `join(agentDir, "..", "cron")` silently
// became ~/.pi/agent/cron, and the two real jobs in ~/.pi/cron stopped being read.
const CRON_DIR = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(CRON_DIR, "jobs.json");
const RUNS_DIR = path.join(CRON_DIR, "runs");

// ── Job Store ──

export function loadStore(): CronStoreFile {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    const store = JSON.parse(raw) as CronStoreFile;
    if (store.version === 1 && Array.isArray(store.jobs)) {
      return store;
    }
  } catch {
    // File doesn't exist or is corrupt — start fresh
  }
  return { version: 1, jobs: [] };
}

export function saveStore(store: CronStoreFile): void {
  fs.mkdirSync(CRON_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

export function persistJob(job: CronJob, store: CronStoreFile): void {
  const idx = store.jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) {
    store.jobs[idx] = job;
  } else {
    store.jobs.push(job);
  }
  saveStore(store);
}

export function removeJobFromStore(jobId: string, store: CronStoreFile): void {
  store.jobs = store.jobs.filter((j) => j.id !== jobId);
  saveStore(store);
}

// ── Run History ──

export function appendRunLog(entry: CronRunEntry): void {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const logPath = path.join(RUNS_DIR, `${entry.jobId}.jsonl`);
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf-8");
}

export function getRunHistory(jobId: string, limit = 20): CronRunEntry[] {
  const logPath = path.join(RUNS_DIR, `${jobId}.jsonl`);
  try {
    const raw = fs.readFileSync(logPath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const entries = lines.map((l) => JSON.parse(l) as CronRunEntry);
    return entries.slice(-limit).reverse();
  } catch {
    return [];
  }
}

// ── ID generation ──

export function generateJobId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `cron-${ts}-${rand}`;
}

export function generateRunId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `run-${ts}-${rand}`;
}

export { CRON_DIR, STORE_PATH, RUNS_DIR };