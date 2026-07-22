/**
 * Observability Extension — Harness Instrumentation & Verification Layer
 *
 * Records structured run records for every agent run:
 *   - prompts, turns, tool calls, failures, duration, token usage, cost
 *   - classifies failure causes
 *   - enforces completion checks (tool error rate, empty output)
 *
 * Output: ~/.pi/agent/observability/runs.jsonl
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ───────────────────────────────────────────────────────────────────

interface ToolRecord {
  name: string;
  args: Record<string, unknown>;
  durationMs: number;
  isError: boolean;
  resultSize: number; // chars of content
  startTime: string;
}

interface TurnRecord {
  index: number;
  startTime: string;
  durationMs: number;
  model?: string;
  toolCalls: ToolRecord[];
  tokenUsage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
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
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
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

const OBS_DIR = join(homedir(), ".pi", "agent", "observability");

let currentRun: RunRecord | null = null;
let currentTurn: TurnRecord | null = null;
let currentTool: ToolRecord | null = null;
let toolStartHr: [number, number] | null = null;
let turnStartHr: [number, number] | null = null;
let runStartHr: [number, number] | null = null;
let turnIndex = 0;
let firstPrompt = "";

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

function ensureDir() {
  mkdirSync(OBS_DIR, { recursive: true });
}

function writeRecord(record: RunRecord) {
  ensureDir();
  const file = join(OBS_DIR, "runs.jsonl");
  appendFileSync(file, JSON.stringify(record) + "\n");
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
  // Check for tool errors
  if (run.totals.toolsFailed > 0 && run.totals.toolsCalled > 0) {
    if (run.totals.toolsFailed === run.totals.toolsCalled) {
      return "all_tools_failed";
    }
    if (run.totals.toolsFailed / run.totals.toolsCalled > 0.5) {
      return "majority_tools_failed";
    }
    return "some_tools_failed";
  }

  // Check for model errors
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

  // Compute totals
  run.totals = run.turns.reduce(
    (acc, t) => {
      if (t.tokenUsage) {
        acc.tokens.input += t.tokenUsage.input;
        acc.tokens.output += t.tokenUsage.output;
        acc.tokens.cacheRead += t.tokenUsage.cacheRead;
        acc.tokens.cacheWrite += t.tokenUsage.cacheWrite;
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
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      toolsCalled: 0,
      toolsFailed: 0,
      errors: 0,
    },
  );

  // Determine completion
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
  // Truncate large string args for readability
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

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── Agent lifecycle ────────────────────────────────────────────────────

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
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
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
    // finalize the current turn if still open
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
      writeRecord(run);

      // Notify on failures
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

  // ── Turn lifecycle ─────────────────────────────────────────────────────

  pi.on("turn_start", async (event, ctx) => {
    turnStartHr = hrNow();
    turnIndex++;

    currentTurn = {
      index: turnIndex,
      startTime: isoNow(),
      durationMs: 0,
      model: undefined,
      toolCalls: [],
      tokenUsage: undefined,
      cost: undefined,
      assistantTextLength: 0,
      errors: [],
    };
  });

  pi.on("turn_end", async (event, ctx) => {
    if (!currentTurn) return;
    if (turnStartHr) {
      currentTurn.durationMs = hrDeltaMs(turnStartHr);
    }

    // Capture tool results summary
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

  // ── Tool lifecycle ─────────────────────────────────────────────────────

  pi.on("tool_execution_start", async (event, ctx) => {
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

  pi.on("tool_execution_end", async (event, ctx) => {
    if (!currentTool) return;
    currentTool.durationMs = toolStartHr ? hrDeltaMs(toolStartHr) : 0;
    currentTool.isError = event.isError ?? false;

    // Estimate result size
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

  // ── Message lifecycle (token usage) ────────────────────────────────────

  pi.on("message_end", async (event, ctx) => {
    if (!currentTurn) return;
    const msg = event.message as {
      role?: string;
      usage?: Record<string, unknown>;
      content?: unknown[];
    };

    if (msg.role === "assistant" && msg.usage) {
      const u = msg.usage as Record<string, number>;
      // Pi uses short field names: input, output, cacheRead, cacheWrite, totalTokens
      currentTurn.tokenUsage = {
        input: u.input ?? u.inputTokens ?? u.input_tokens ?? 0,
        output: u.output ?? u.outputTokens ?? u.output_tokens ?? 0,
        cacheRead: u.cacheRead ?? u.cacheReadTokens ?? u.cache_read_tokens ?? 0,
        cacheWrite: u.cacheWrite ?? u.cacheWriteTokens ?? u.cache_write_tokens ?? 0,
        total: u.totalTokens ?? u.total_tokens ?? 0,
      };
      if (u.cost && typeof u.cost === "object") {
        const c = u.cost as Record<string, number>;
        currentTurn.cost = {
          input: c.input ?? 0,
          output: c.output ?? 0,
          cacheRead: c.cacheRead ?? c.cache_read ?? 0,
          cacheWrite: c.cacheWrite ?? c.cache_write ?? 0,
          total: c.total ?? 0,
        };
      }

      // Track assistant text length
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
    }
  });

  // ── Input capture ──────────────────────────────────────────────────────

  pi.on("input", async (event, ctx) => {
    const text = event.text?.trim();
    if (text && !firstPrompt) {
      firstPrompt = text.slice(0, 1000);
    }
    if (text && currentRun && currentRun.prompt === "(unknown)") {
      currentRun.prompt = text.slice(0, 1000);
    }
  });

  // Fallback: also try before_agent_start for prompts that bypass input expansion
  pi.on("before_agent_start", async (event, ctx) => {
    const promptText = (event as { prompt?: string }).prompt?.trim();
    if (promptText && !firstPrompt) {
      firstPrompt = promptText.slice(0, 1000);
    }
    if (promptText && currentRun && currentRun.prompt === "(unknown)") {
      currentRun.prompt = promptText.slice(0, 1000);
    }
  });

  // ── Session lifecycle ──────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    ensureDir();
    ctx.ui.notify("📊 Observability active", "info");
  });

  // ── Shutdown ───────────────────────────────────────────────────────────

  pi.on("session_shutdown", async (_event, ctx) => {
    // Flush any pending run
    if (currentRun) {
      const run = finalizeRun();
      if (run) writeRecord(run);
    }
    resetRun();
  });
}
