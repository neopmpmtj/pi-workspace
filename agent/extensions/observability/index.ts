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
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
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
  check_assistant_text_length INTEGER NOT NULL DEFAULT 0
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

function getDb(): DatabaseSync {
  if (sqliteDb) return sqliteDb;
  ensureDir();
  sqliteDb = new DatabaseSync(SQLITE_PATH);
  sqliteDb.exec("PRAGMA journal_mode=WAL");
  sqliteDb.exec("PRAGMA foreign_keys=ON");
  sqliteDb.exec(SCHEMA_SQL);
  return sqliteDb;
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
        check_empty_output_passed, check_assistant_text_length
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?
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

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.on("agent_start", async (_event, ctx) => {
    resetRun();

    const sm = ctx.sessionManager;
    runStartHr = hrNow();

    currentRun = {
      runId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: sm.getSessionId?.() ?? "unknown",
      sessionFile: sm.getSessionFile?.() ?? undefined,
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
