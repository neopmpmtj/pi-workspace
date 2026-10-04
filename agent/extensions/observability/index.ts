/**
 * Observability Extension — Harness Instrumentation & Verification Layer
 *
 * Records structured run records for every agent run:
 *   - prompts, turns, tool calls, failures, duration, token usage, cost
 *   - classifies failure causes
 *   - enforces completion checks (tool error rate, empty output)
 *
 * Output: ~/.pi/agent/observability/
 *   runs.jsonl    append-only audit log
 *   runs.sqlite   same records, inserted after each JSONL line
 *
 * Loaded by default `pi` (global agent dir). One growing DB for all
 * default-identity sessions; filter later by sessionId / startTime.
 *
 * Token accounting (the point of this extension):
 *   prompt     = input + cacheRead + cacheWrite   (context re-sent each call)
 *   completion = output, of which `reasoning` is a SUBSET (never additive)
 *   total      = prompt + completion
 * Cache reads dominate `total` (~98% on real turns), so the total alone is
 * uninformative — the split and the cache hit ratio are the signal.
 *
 * Delegation lineage: subagent processes are linked to their orchestrator via
 * parent_session_id, so `/tokens` can roll a whole fan-out into one number.
 * Subagents are spawned by two different packages (see readDelegation).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

// ── Types ───────────────────────────────────────────────────────────────────

interface ToolRecord {
  name: string;
  args: Record<string, unknown>;
  durationMs: number;
  isError: boolean;
  resultSize: number; // chars of content
  startTime: string;
}

interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
}

interface CostUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

interface TurnRecord {
  index: number;
  startTime: string;
  durationMs: number;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  stopReason?: string;
  responseId?: string;
  api?: string;
  toolCalls: ToolRecord[];
  tokenUsage?: TokenUsage;
  cost?: CostUsage;
  assistantTextLength: number;
  errors: string[];
}

interface RunRecord {
  runId: string;
  sessionId: string;
  sessionFile?: string;
  /** Set only when this process ran as a subagent; absent for orchestrators. */
  parentSessionId?: string;
  agentName?: string;
  handle?: string;
  depth?: number;
  startTime: string;
  endTime?: string;
  durationMs: number;
  prompt: string;
  turnCount: number;
  turns: TurnRecord[];
  totals: {
    tokens: TokenUsage;
    cost: CostUsage;
    toolsCalled: number;
    toolsFailed: number;
    errors: number;
  };
  completion: "success" | "error" | "aborted" | "unknown";
  failureClassification: string | null;
  checks: {
    toolErrorRate: { passed: boolean; rate: number; threshold: number };
    emptyOutput: { passed: boolean; totalAssistantText: number };
  };
}

// ── State ───────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const OBS_DIR = join(__dirname, "..", "..", "observability");
const SQLITE_PATH = join(OBS_DIR, "runs.sqlite");

const ZERO_TOKENS: TokenUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  total: 0,
};

const ZERO_COST: CostUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
};

let currentRun: RunRecord | null = null;
let currentTurn: TurnRecord | null = null;
let currentTool: ToolRecord | null = null;
let toolStartHr: [number, number] | null = null;
let turnStartHr: [number, number] | null = null;
let runStartHr: [number, number] | null = null;
let turnIndex = 0;
let firstPrompt = "";
let sqliteDb: DatabaseSync | null = null;

// ── Helpers ─────────────────────────────────────────────────────────────────

function hrNow(): [number, number] {
  return process.hrtime();
}

function hrDeltaMs(start: [number, number]): number {
  const [s, ns] = process.hrtime(start);
  return Math.round(s * 1000 + ns / 1e6);
}

function isoNow(): string {
  return new Date().toISOString();
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optStr(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

interface DelegationInfo {
  parentSessionId?: string;
  agentName?: string;
  handle?: string;
  depth?: number;
}

/** `<tmp>/pi-subagents/<parentSessionId>/<child>.jsonl` -> `<parentSessionId>`. */
function deriveParentSessionId(sessionFile: string): string | undefined {
  const root = join(tmpdir(), "pi-subagents") + sep;
  if (!sessionFile.startsWith(root)) return undefined;
  const parts = sessionFile.slice(root.length).split(sep).filter(Boolean);
  return parts.length >= 2 ? parts[0] : undefined;
}

/**
 * Resolve this process's position in the delegation tree.
 *
 * Two different packages create subagents, with different fidelity:
 *   - `@mjakl/pi-subagent` (the `subagent` tool) exports a versioned contract
 *     PI_SUBAGENT_DELEGATION = {version, childSessionId, parentSessionId, agent, handle}.
 *   - `pi-agents-pool` (the `spawn_agent` tool) sets no payload at all, but
 *     names the child session file <tmp>/pi-subagents/<parentSessionId>/<child>.jsonl,
 *     so the parent is recovered from the path (the agent name is not).
 * Both set PI_SUBAGENT_DEPTH.
 *
 * The payload is validated against the live session id, so a stale payload
 * (e.g. after a session switch inside a long-lived process) is ignored rather
 * than silently mis-attributed to the wrong orchestrator.
 */
function readDelegation(sessionId: string | undefined, sessionFile: string | undefined): DelegationInfo {
  const info: DelegationInfo = {};

  const raw = process.env.PI_SUBAGENT_DELEGATION;
  if (raw) {
    try {
      const d = JSON.parse(raw) as Record<string, unknown>;
      const child = optStr(d?.childSessionId);
      const childMatches = !sessionId || !child || child === sessionId;
      if (d && d.version === 1 && childMatches) {
        info.parentSessionId = optStr(d.parentSessionId);
        info.agentName = optStr(d.agent);
        info.handle = optStr(d.handle);
      }
    } catch {
      // Malformed payload: fall through to the session-file convention.
    }
  }

  if (!info.parentSessionId && sessionFile) {
    info.parentSessionId = deriveParentSessionId(sessionFile);
  }

  const depthRaw = process.env.PI_SUBAGENT_DEPTH;
  if (depthRaw !== undefined) {
    const depth = Number.parseInt(depthRaw, 10);
    if (Number.isFinite(depth) && depth >= 0) info.depth = depth;
  }

  // PI_SUBAGENT_STACK (ancestor chain + this agent's name) is exported by
  // @mjakl/pi-subagent even when the delegation payload is omitted — which is
  // the case for a child with no persistent session, e.g. `initialContext:
  // "empty"`. Without this, such a child still records depth but loses its
  // agent name. The parent session id remains unavailable on that path.
  if (!info.agentName) {
    const stackRaw = process.env.PI_SUBAGENT_STACK;
    if (stackRaw) {
      try {
        const stack = JSON.parse(stackRaw) as unknown;
        if (Array.isArray(stack) && stack.length > 0) {
          info.agentName = optStr(stack[stack.length - 1]);
        }
      } catch {
        // Malformed stack: leave the agent name unset.
      }
    }
  }

  return info;
}

function ensureDir() {
  mkdirSync(OBS_DIR, { recursive: true });
}

function writeRecord(record: RunRecord) {
  ensureDir();
  const file = join(OBS_DIR, "runs.jsonl");
  appendFileSync(file, JSON.stringify(record) + "\n");
}

function persistRun(record: RunRecord) {
  writeRecord(record);
  try {
    insertRun(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[observability] sqlite insert failed: ${message}`);
  }
}

function resetRun() {
  currentRun = null;
  currentTurn = null;
  currentTool = null;
  toolStartHr = null;
  turnStartHr = null;
  runStartHr = null;
  turnIndex = 0;
  // Note: do NOT reset firstPrompt here — it must survive across agent_start
}

function classifyFailure(run: RunRecord): string | null {
  if (run.totals.toolsFailed > 0 && run.totals.toolsCalled > 0) {
    if (run.totals.toolsFailed === run.totals.toolsCalled) {
      return "all_tools_failed";
    }
    if (run.totals.toolsFailed / run.totals.toolsCalled > 0.5) {
      return "majority_tools_failed";
    }
    return "some_tools_failed";
  }

  const hasModelErrors = run.turns.some((t) => t.errors.length > 0);
  if (hasModelErrors) {
    return "model_errors";
  }

  return null;
}

function computeChecks(run: RunRecord) {
  const totalAssistantText = run.turns.reduce(
    (sum, t) => sum + t.assistantTextLength,
    0,
  );

  const toolErrorRate =
    run.totals.toolsCalled > 0
      ? run.totals.toolsFailed / run.totals.toolsCalled
      : 0;

  return {
    toolErrorRate: {
      passed: toolErrorRate <= 0.5,
      rate: Math.round(toolErrorRate * 100) / 100,
      threshold: 0.5,
    },
    emptyOutput: {
      passed: totalAssistantText > 0,
      totalAssistantText,
    },
  };
}

function finalizeRun(): RunRecord | null {
  if (!currentRun) return null;
  const run = currentRun;
  run.endTime = isoNow();
  run.durationMs = runStartHr ? hrDeltaMs(runStartHr) : 0;
  run.turnCount = turnIndex;

  run.totals = run.turns.reduce(
    (acc, t) => {
      if (t.tokenUsage) {
        acc.tokens.input += t.tokenUsage.input;
        acc.tokens.output += t.tokenUsage.output;
        acc.tokens.cacheRead += t.tokenUsage.cacheRead;
        acc.tokens.cacheWrite += t.tokenUsage.cacheWrite;
        acc.tokens.reasoning += t.tokenUsage.reasoning;
        acc.tokens.total += t.tokenUsage.total;
      }
      if (t.cost) {
        acc.cost.input += t.cost.input;
        acc.cost.output += t.cost.output;
        acc.cost.cacheRead += t.cost.cacheRead;
        acc.cost.cacheWrite += t.cost.cacheWrite;
        acc.cost.total += t.cost.total;
      }
      acc.toolsCalled += t.toolCalls.length;
      acc.toolsFailed += t.toolCalls.filter((c) => c.isError).length;
      acc.errors += t.errors.length;
      return acc;
    },
    {
      tokens: { ...ZERO_TOKENS },
      cost: { ...ZERO_COST },
      toolsCalled: 0,
      toolsFailed: 0,
      errors: 0,
    },
  );

  if (run.totals.errors > 0) {
    run.completion = "error";
  } else if (run.turns.length > 0) {
    run.completion = "success";
  } else {
    run.completion = "unknown";
  }

  run.failureClassification = classifyFailure(run);
  run.checks = computeChecks(run);

  return run;
}

function flattenArgs(args: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.length > 500) {
      flat[k] = v.slice(0, 500) + `... [${v.length - 500} more chars]`;
    } else {
      flat[k] = v;
    }
  }
  return flat;
}

// ── SQLite ──────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  session_file TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  duration_ms INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  turn_count INTEGER NOT NULL,
  completion TEXT NOT NULL,
  failure_classification TEXT,
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read INTEGER NOT NULL DEFAULT 0,
  tokens_cache_write INTEGER NOT NULL DEFAULT 0,
  tokens_reasoning INTEGER NOT NULL DEFAULT 0,
  tokens_total INTEGER NOT NULL DEFAULT 0,
  cost_input REAL NOT NULL DEFAULT 0,
  cost_output REAL NOT NULL DEFAULT 0,
  cost_cache_read REAL NOT NULL DEFAULT 0,
  cost_cache_write REAL NOT NULL DEFAULT 0,
  cost_total REAL NOT NULL DEFAULT 0,
  tools_called INTEGER NOT NULL DEFAULT 0,
  tools_failed INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  check_tool_error_rate REAL NOT NULL DEFAULT 0,
  check_tool_error_passed INTEGER NOT NULL DEFAULT 1,
  check_empty_output_passed INTEGER NOT NULL DEFAULT 1,
  check_assistant_text_length INTEGER NOT NULL DEFAULT 0,
  parent_session_id TEXT,
  agent_name TEXT,
  handle TEXT,
  depth INTEGER
);

CREATE TABLE IF NOT EXISTS turns (
  run_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  model TEXT,
  provider TEXT,
  thinking_level TEXT,
  stop_reason TEXT,
  response_id TEXT,
  api TEXT,
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read INTEGER NOT NULL DEFAULT 0,
  tokens_cache_write INTEGER NOT NULL DEFAULT 0,
  tokens_reasoning INTEGER NOT NULL DEFAULT 0,
  tokens_total INTEGER NOT NULL DEFAULT 0,
  cost_input REAL NOT NULL DEFAULT 0,
  cost_output REAL NOT NULL DEFAULT 0,
  cost_cache_read REAL NOT NULL DEFAULT 0,
  cost_cache_write REAL NOT NULL DEFAULT 0,
  cost_total REAL NOT NULL DEFAULT 0,
  assistant_text_length INTEGER NOT NULL DEFAULT 0,
  errors TEXT,
  PRIMARY KEY (run_id, turn_index),
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
);

CREATE TABLE IF NOT EXISTS tool_calls (
  run_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  name TEXT NOT NULL,
  args TEXT,
  duration_ms INTEGER NOT NULL,
  is_error INTEGER NOT NULL DEFAULT 0,
  result_size INTEGER NOT NULL DEFAULT 0,
  start_time TEXT,
  PRIMARY KEY (run_id, turn_index, ordinal),
  FOREIGN KEY (run_id, turn_index) REFERENCES turns(run_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_runs_start_time ON runs(start_time);
CREATE INDEX IF NOT EXISTS idx_turns_model ON turns(model);
`;

// Existing DBs predate the lineage columns and CREATE TABLE IF NOT EXISTS will
// not add them, so ALTER for whatever is missing (idempotent).
const LINEAGE_COLUMNS: Array<[string, string]> = [
  ["parent_session_id", "TEXT"],
  ["agent_name", "TEXT"],
  ["handle", "TEXT"],
  ["depth", "INTEGER"],
];

// Token-first rollups. `session_root` resolves the delegation tree at query
// time because a child settles BEFORE its parent's run is recorded — so a walk
// at insert time cannot see the parent yet. Climbs 3 hops, matching the
// runtime guard's max depth of 3.
const VIEWS_SQL = `
DROP VIEW IF EXISTS session_parent;
CREATE VIEW session_parent AS
SELECT session_id, MIN(parent_session_id) AS parent_session_id
FROM runs
WHERE parent_session_id IS NOT NULL
GROUP BY session_id;

DROP VIEW IF EXISTS session_root;
CREATE VIEW session_root AS
SELECT s.session_id,
       COALESCE(l3.parent_session_id, l2.parent_session_id, l1.parent_session_id,
                s.session_id) AS root_session_id,
       CASE WHEN l3.parent_session_id IS NOT NULL THEN 3
            WHEN l2.parent_session_id IS NOT NULL THEN 2
            WHEN l1.parent_session_id IS NOT NULL THEN 1
            ELSE 0 END AS root_distance
FROM (SELECT DISTINCT session_id FROM runs) s
LEFT JOIN session_parent l1 ON l1.session_id = s.session_id
LEFT JOIN session_parent l2 ON l2.session_id = l1.parent_session_id
LEFT JOIN session_parent l3 ON l3.session_id = l2.parent_session_id;

DROP VIEW IF EXISTS run_tokens;
CREATE VIEW run_tokens AS
SELECT r.run_id, r.session_id, r.parent_session_id, r.agent_name, r.handle, r.depth,
       sr.root_session_id, sr.root_distance,
       r.tokens_input + r.tokens_cache_read + r.tokens_cache_write AS prompt_tokens,
       r.tokens_output AS completion_tokens,
       r.tokens_reasoning AS reasoning_tokens,
       r.tokens_total,
       r.tokens_input, r.tokens_cache_read, r.tokens_cache_write,
       r.tokens_output, r.tokens_reasoning,
       CASE WHEN r.tokens_input + r.tokens_cache_read + r.tokens_cache_write > 0
            THEN ROUND(CAST(r.tokens_cache_read AS REAL) /
                 (r.tokens_input + r.tokens_cache_read + r.tokens_cache_write), 4)
       END AS cache_hit_ratio,
       CASE WHEN r.turn_count > 0
            THEN ROUND(CAST(r.tokens_total AS REAL) / r.turn_count, 1) END AS tokens_per_turn,
       r.turn_count, r.tools_called, r.start_time
FROM runs r
LEFT JOIN session_root sr ON sr.session_id = r.session_id;

DROP VIEW IF EXISTS session_tokens;
CREATE VIEW session_tokens AS
SELECT rt.root_session_id,
       COUNT(*) AS runs,
       SUM(rt.tokens_input) AS input_tokens,
       SUM(rt.tokens_cache_read) AS cache_read_tokens,
       SUM(rt.tokens_cache_write) AS cache_write_tokens,
       SUM(rt.completion_tokens) AS output_tokens,
       SUM(rt.reasoning_tokens) AS reasoning_tokens,
       SUM(rt.tokens_total) AS total_tokens,
       SUM(rt.turn_count) AS turns,
       SUM(rt.tools_called) AS tools_called,
       SUM(CASE WHEN rt.parent_session_id IS NOT NULL THEN 1 ELSE 0 END) AS subagent_runs
FROM run_tokens rt
GROUP BY rt.root_session_id;

-- All-time rollup across every root session in this DB.
DROP VIEW IF EXISTS agent_tokens;
CREATE VIEW agent_tokens AS
SELECT COALESCE(agent_name, CASE WHEN parent_session_id IS NULL
              THEN '(orchestrator)' ELSE '(unnamed subagent)' END) AS agent,
       COUNT(*) AS runs,
       SUM(tokens_total) AS total_tokens,
       SUM(tokens_output) AS output_tokens,
       SUM(turn_count) AS turns
FROM run_tokens
GROUP BY 1;
`;

function getDb(): DatabaseSync {
  if (sqliteDb) return sqliteDb;
  ensureDir();
  // Initialize into a local first: only publish to `sqliteDb` once the
  // schema is known-good. Otherwise a failed PRAGMA/SCHEMA_SQL would leave
  // a half-initialized handle cached here and every later getDb() call
  // would return it — never retrying the schema, so every insert fails.
  const db = new DatabaseSync(SQLITE_PATH);
  try {
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(SCHEMA_SQL);
    const existing = new Set(
      (db.prepare("PRAGMA table_info(runs)").all() as Array<{ name?: unknown }>).map((row) =>
        String(row.name),
      ),
    );
    for (const [column, type] of LINEAGE_COLUMNS) {
      if (!existing.has(column)) db.exec(`ALTER TABLE runs ADD COLUMN ${column} ${type}`);
    }
    db.exec(VIEWS_SQL);
  } catch (err) {
    try {
      db.close();
    } catch {
      // ignore close failure
    }
    sqliteDb = null;
    throw err;
  }
  sqliteDb = db;
  return db;
}

function insertRun(run: RunRecord) {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const runResult = db.prepare(`
      INSERT OR IGNORE INTO runs (
        run_id, session_id, session_file, start_time, end_time, duration_ms,
        prompt, turn_count, completion, failure_classification,
        tokens_input, tokens_output, tokens_cache_read, tokens_cache_write,
        tokens_reasoning, tokens_total,
        cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total,
        tools_called, tools_failed, errors,
        check_tool_error_rate, check_tool_error_passed,
        check_empty_output_passed, check_assistant_text_length,
        parent_session_id, agent_name, handle, depth
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?, ?
      )
    `).run(
      run.runId,
      run.sessionId,
      run.sessionFile ?? null,
      run.startTime,
      run.endTime ?? null,
      run.durationMs,
      run.prompt,
      run.turnCount,
      run.completion,
      run.failureClassification,
      run.totals.tokens.input,
      run.totals.tokens.output,
      run.totals.tokens.cacheRead,
      run.totals.tokens.cacheWrite,
      run.totals.tokens.reasoning,
      run.totals.tokens.total,
      run.totals.cost.input,
      run.totals.cost.output,
      run.totals.cost.cacheRead,
      run.totals.cost.cacheWrite,
      run.totals.cost.total,
      run.totals.toolsCalled,
      run.totals.toolsFailed,
      run.totals.errors,
      run.checks.toolErrorRate.rate,
      run.checks.toolErrorRate.passed ? 1 : 0,
      run.checks.emptyOutput.passed ? 1 : 0,
      run.checks.emptyOutput.totalAssistantText,
      run.parentSessionId ?? null,
      run.agentName ?? null,
      run.handle ?? null,
      run.depth ?? null,
    );

    if (runResult.changes === 0) {
      db.exec("ROLLBACK");
      return;
    }

    const insertTurn = db.prepare(`
      INSERT INTO turns (
        run_id, turn_index, start_time, duration_ms,
        model, provider, thinking_level, stop_reason, response_id, api,
        tokens_input, tokens_output, tokens_cache_read, tokens_cache_write,
        tokens_reasoning, tokens_total,
        cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total,
        assistant_text_length, errors
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
    `);

    const insertTool = db.prepare(`
      INSERT INTO tool_calls (
        run_id, turn_index, ordinal, name, args, duration_ms, is_error, result_size, start_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const turn of run.turns) {
      const tokens = turn.tokenUsage ?? ZERO_TOKENS;
      const cost = turn.cost ?? ZERO_COST;
      insertTurn.run(
        run.runId,
        turn.index,
        turn.startTime,
        turn.durationMs,
        turn.model ?? null,
        turn.provider ?? null,
        turn.thinkingLevel ?? null,
        turn.stopReason ?? null,
        turn.responseId ?? null,
        turn.api ?? null,
        tokens.input,
        tokens.output,
        tokens.cacheRead,
        tokens.cacheWrite,
        tokens.reasoning,
        tokens.total,
        cost.input,
        cost.output,
        cost.cacheRead,
        cost.cacheWrite,
        cost.total,
        turn.assistantTextLength,
        JSON.stringify(turn.errors),
      );

      turn.toolCalls.forEach((tool, ordinal) => {
        insertTool.run(
          run.runId,
          turn.index,
          ordinal,
          tool.name,
          JSON.stringify(tool.args),
          tool.durationMs,
          tool.isError ? 1 : 0,
          tool.resultSize,
          tool.startTime,
        );
      });
    }

    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw err;
  }
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** Human-readable token rollup for one root session, plus all-time by agent. */
function tokenReport(db: DatabaseSync, sessionId: string | undefined): string {
  const lines: string[] = [];

  const rootRow = sessionId
    ? (db.prepare("SELECT root_session_id FROM session_root WHERE session_id = ?").get(sessionId) as
        | { root_session_id?: string }
        | undefined)
    : undefined;
  // A session with no recorded run yet is still reportable on its own.
  const root = rootRow?.root_session_id ?? sessionId;

  if (root) {
    const t = db
      .prepare(
        `SELECT COUNT(*) AS runs,
                COALESCE(SUM(r.tokens_input), 0) AS input_tokens,
                COALESCE(SUM(r.tokens_cache_read), 0) AS cache_read,
                COALESCE(SUM(r.tokens_cache_write), 0) AS cache_write,
                COALESCE(SUM(r.tokens_output), 0) AS output_tokens,
                COALESCE(SUM(r.tokens_reasoning), 0) AS reasoning,
                COALESCE(SUM(r.tokens_total), 0) AS total,
                COALESCE(SUM(r.turn_count), 0) AS turns,
                COALESCE(SUM(r.tools_called), 0) AS tools,
                COALESCE(SUM(CASE WHEN r.parent_session_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS subagent_runs
         FROM runs r
         JOIN session_root sr ON sr.session_id = r.session_id
         WHERE sr.root_session_id = ?`,
      )
      .get(root) as Record<string, number>;

    const prompt = t.input_tokens + t.cache_read + t.cache_write;
    const cachePct = prompt > 0 ? ((t.cache_read / prompt) * 100).toFixed(1) + "%" : "n/a";

    lines.push(`Tokens — this session + subagents (${shortId(root)})`);
    lines.push(`  total        ${fmt(t.total)}`);
    lines.push(
      `  prompt       ${fmt(prompt)}  = input ${fmt(t.input_tokens)} + cacheRead ${fmt(t.cache_read)}` +
        (t.cache_write > 0 ? ` + cacheWrite ${fmt(t.cache_write)}` : ""),
    );
    lines.push(`  completion   ${fmt(t.output_tokens)}  (reasoning ${fmt(t.reasoning)} is a subset)`);
    lines.push(`  cache hit    ${cachePct}`);
    lines.push(
      `  ${fmt(t.runs)} runs (${fmt(t.subagent_runs)} subagent) · ${fmt(t.turns)} turns · ${fmt(t.tools)} tools`,
    );

    const perAgent = db
      .prepare(
        `SELECT COALESCE(r.agent_name, CASE WHEN r.parent_session_id IS NULL
                        THEN '(orchestrator)' ELSE '(unnamed subagent)' END) AS agent,
                COUNT(*) AS runs,
                COALESCE(SUM(r.tokens_total), 0) AS total
         FROM runs r
         JOIN session_root sr ON sr.session_id = r.session_id
         WHERE sr.root_session_id = ?
         GROUP BY 1
         ORDER BY total DESC`,
      )
      .all(root) as Array<Record<string, unknown>>;

    if (perAgent.length > 1) {
      lines.push("");
      lines.push("  by agent (this session)");
      for (const a of perAgent) {
        lines.push(
          `    ${String(a.agent).padEnd(24)}${fmt(Number(a.total)).padStart(12)}  (${a.runs} runs)`,
        );
      }
    }

    const subs = db
      .prepare(
        `SELECT r.session_id, r.agent_name, r.depth,
                COUNT(*) AS runs,
                COALESCE(SUM(r.tokens_total), 0) AS total
         FROM runs r
         JOIN session_root sr ON sr.session_id = r.session_id
         WHERE sr.root_session_id = ? AND r.parent_session_id IS NOT NULL
         GROUP BY r.session_id
         ORDER BY total DESC`,
      )
      .all(root) as Array<Record<string, unknown>>;

    if (subs.length > 0) {
      lines.push("");
      lines.push("  subagent runs");
      for (const s of subs) {
        const who = s.agent_name ? String(s.agent_name) : "(unnamed)";
        lines.push(
          `    ${shortId(String(s.session_id))}  d${s.depth ?? "?"}  ${who.padEnd(16)}${fmt(Number(s.total)).padStart(12)}`,
        );
      }
    }
  } else {
    lines.push("Tokens — no session id available.");
  }

  const global = db
    .prepare(
      `SELECT agent, runs, total_tokens FROM agent_tokens ORDER BY total_tokens DESC LIMIT 8`,
    )
    .all() as Array<Record<string, unknown>>;

  if (global.length > 0) {
    lines.push("");
    lines.push("  all-time by agent (whole DB)");
    for (const g of global) {
      lines.push(
        `    ${String(g.agent).padEnd(24)}${fmt(Number(g.total_tokens)).padStart(12)}  (${g.runs} runs)`,
      );
    }
  }

  return lines.join("\n");
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand("tokens", {
    description: "Token consumption for this session + its subagents, and all-time totals by agent",
    handler: async (_args, ctx) => {
      try {
        const sessionId = ctx.sessionManager.getSessionId?.();
        ctx.ui.notify(tokenReport(getDb(), sessionId), "info");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`tokens: ${message}`, "error");
      }
    },
  });

  pi.on("agent_start", async (_event, ctx) => {
    resetRun();

    const sm = ctx.sessionManager;
    runStartHr = hrNow();

    const sessionId = sm.getSessionId?.() ?? "unknown";
    const sessionFile = sm.getSessionFile?.() ?? undefined;
    const delegation = readDelegation(sessionId, sessionFile);

    currentRun = {
      runId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      sessionFile,
      parentSessionId: delegation.parentSessionId,
      agentName: delegation.agentName,
      handle: delegation.handle,
      depth: delegation.depth,
      startTime: isoNow(),
      durationMs: 0,
      prompt: firstPrompt || "(unknown)",
      turnCount: 0,
      turns: [],
      totals: {
        tokens: { ...ZERO_TOKENS },
        cost: { ...ZERO_COST },
        toolsCalled: 0,
        toolsFailed: 0,
        errors: 0,
      },
      completion: "unknown",
      failureClassification: null,
      checks: {
        toolErrorRate: { passed: true, rate: 0, threshold: 0.5 },
        emptyOutput: { passed: true, totalAssistantText: 0 },
      },
    };
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (currentTurn && turnStartHr) {
      currentTurn.durationMs = hrDeltaMs(turnStartHr);
      currentRun?.turns.push(currentTurn);
      currentTurn = null;
      turnStartHr = null;
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const run = finalizeRun();
    if (run) {
      persistRun(run);

      if (run.failureClassification) {
        ctx.ui.notify(
          `⚠ Obs: ${run.failureClassification} | ${run.totals.tokens.total} tokens | ${run.totals.toolsCalled} tools`,
          "warning",
        );
      } else if (run.completion === "success") {
        ctx.ui.notify(
          `✓ ${run.totals.tokens.total} tokens · ${run.turnCount} turns · ${run.totals.toolsCalled} tools`,
          "info",
        );
      }
    }
    resetRun();
  });

  pi.on("turn_start", async (_event, _ctx) => {
    turnStartHr = hrNow();
    turnIndex++;

    currentTurn = {
      index: turnIndex,
      startTime: isoNow(),
      durationMs: 0,
      model: undefined,
      provider: undefined,
      thinkingLevel: undefined,
      stopReason: undefined,
      responseId: undefined,
      api: undefined,
      toolCalls: [],
      tokenUsage: undefined,
      cost: undefined,
      assistantTextLength: 0,
      errors: [],
    };
  });

  pi.on("turn_end", async (event, _ctx) => {
    if (!currentTurn) return;
    if (turnStartHr) {
      currentTurn.durationMs = hrDeltaMs(turnStartHr);
    }

    if (event.toolResults && Array.isArray(event.toolResults)) {
      for (const tr of event.toolResults) {
        if (tr.isError) {
          currentTurn.errors.push(
            `Tool ${tr.toolName} failed: ${JSON.stringify(tr.input).slice(0, 200)}`,
          );
        }
      }
    }

    currentRun?.turns.push(currentTurn);
    currentTurn = null;
    turnStartHr = null;
  });

  pi.on("tool_execution_start", async (event, _ctx) => {
    toolStartHr = hrNow();
    currentTool = {
      name: event.toolName,
      args: flattenArgs((event.args ?? {}) as Record<string, unknown>),
      durationMs: 0,
      isError: false,
      resultSize: 0,
      startTime: isoNow(),
    };
  });

  pi.on("tool_execution_end", async (event, _ctx) => {
    if (!currentTool) return;
    currentTool.durationMs = toolStartHr ? hrDeltaMs(toolStartHr) : 0;
    currentTool.isError = event.isError ?? false;

    if (event.result) {
      const content = (event.result as { content?: unknown[] }).content;
      if (Array.isArray(content)) {
        currentTool.resultSize = content.reduce((sum, block) => {
          if (typeof block === "object" && block !== null && "text" in block) {
            return sum + String((block as { text: string }).text).length;
          }
          return sum;
        }, 0);
      }
    }

    currentTurn?.toolCalls.push(currentTool);
    currentTool = null;
    toolStartHr = null;
  });

  pi.on("message_end", async (event, _ctx) => {
    if (!currentTurn) return;
    const msg = event.message as {
      role?: string;
      model?: unknown;
      provider?: unknown;
      thinkingLevel?: unknown;
      stopReason?: unknown;
      responseId?: unknown;
      api?: unknown;
      usage?: Record<string, unknown>;
      content?: unknown[];
    };

    if (msg.role !== "assistant") return;

    currentTurn.model = optStr(msg.model) ?? currentTurn.model;
    currentTurn.provider = optStr(msg.provider) ?? currentTurn.provider;
    currentTurn.thinkingLevel = optStr(msg.thinkingLevel) ?? currentTurn.thinkingLevel;
    currentTurn.stopReason = optStr(msg.stopReason) ?? currentTurn.stopReason;
    currentTurn.responseId = optStr(msg.responseId) ?? currentTurn.responseId;
    currentTurn.api = optStr(msg.api) ?? currentTurn.api;

    if (msg.usage) {
      const u = msg.usage;
      currentTurn.tokenUsage = {
        input: num(u.input ?? u.inputTokens ?? u.input_tokens),
        output: num(u.output ?? u.outputTokens ?? u.output_tokens),
        cacheRead: num(u.cacheRead ?? u.cacheReadTokens ?? u.cache_read_tokens),
        cacheWrite: num(u.cacheWrite ?? u.cacheWriteTokens ?? u.cache_write_tokens),
        reasoning: num(u.reasoning ?? u.reasoningTokens ?? u.reasoning_tokens),
        total: num(u.totalTokens ?? u.total_tokens),
      };
      if (u.cost && typeof u.cost === "object") {
        const c = u.cost as Record<string, unknown>;
        currentTurn.cost = {
          input: num(c.input),
          output: num(c.output),
          cacheRead: num(c.cacheRead ?? c.cache_read),
          cacheWrite: num(c.cacheWrite ?? c.cache_write),
          total: num(c.total),
        };
      }
    }

    if (Array.isArray(msg.content)) {
      currentTurn.assistantTextLength = msg.content.reduce((sum, block) => {
        if (
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "text" &&
          "text" in block
        ) {
          return sum + String((block as { text: string }).text).length;
        }
        return sum;
      }, 0);
    }
  });

  pi.on("input", async (event, _ctx) => {
    const text = event.text?.trim();
    if (text && !firstPrompt) {
      firstPrompt = text.slice(0, 1000);
    }
    if (text && currentRun && currentRun.prompt === "(unknown)") {
      currentRun.prompt = text.slice(0, 1000);
    }
  });

  pi.on("before_agent_start", async (event, _ctx) => {
    const promptText = (event as { prompt?: string }).prompt?.trim();
    if (promptText && !firstPrompt) {
      firstPrompt = promptText.slice(0, 1000);
    }
    if (promptText && currentRun && currentRun.prompt === "(unknown)") {
      currentRun.prompt = promptText.slice(0, 1000);
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    ensureDir();
    try {
      getDb();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[observability] sqlite open failed: ${message}`);
    }
    ctx.ui.notify("📊 Observability active", "info");
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    if (currentRun) {
      const run = finalizeRun();
      if (run) persistRun(run);
    }
    resetRun();
    if (sqliteDb) {
      try {
        sqliteDb.close();
      } catch {
        // ignore close failure
      }
      sqliteDb = null;
    }
  });
}
