import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { syncSessions } from "../ledger/ingest.ts";
import { summarizeRuns } from "../ledger/runs.ts";
import { openLedger, readCalls, type CallRecord } from "../ledger/store.ts";
import type { RatesSnapshot } from "../ledger/rate-table.ts";

const rates: RatesSnapshot = {
  source: "file",
  updatedAt: "2026-10-27T08:00:00Z",
  version: "test-version",
  models: {
    "deepseek-flash": [{ effectiveFrom: "2026-01-01T00:00:00Z", input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 }],
    "gpt-5.4": [{ effectiveFrom: "2026-01-01T00:00:00Z", input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 }],
  },
};

const SESSION_ID = "01a17c82-7f3a-76e9-b3d7-b845626e2832";

function line(entry: unknown): string {
  return `${JSON.stringify(entry)}\n`;
}

function sessionFile(): string {
  return [
    line({ type: "session", id: SESSION_ID, timestamp: "2026-10-27T08:00:00.000Z", cwd: "/tmp", version: "1.4.0" }),
    line({ type: "model_change", id: "m1", timestamp: "2026-10-27T08:00:00.100Z" }),
    line({
      type: "message",
      id: "u1",
      timestamp: "2026-10-27T08:00:01.000Z",
      message: { role: "user", content: [{ type: "text", text: "/ask \"what is a vector database?\"" }], timestamp: 1793090001000 },
    }),
    line({
      type: "custom_message",
      id: "c1",
      parentId: "u1",
      timestamp: "2026-10-27T08:00:02.000Z",
      customType: "template-new-agent",
      content: "A vector database…",
      display: true,
      details: { runId: "cmd-run-1", status: "ok" },
    }),
  ].join("");
}

const COMMAND_CALL: CallRecord = {
  callId: "cmd-run-1",
  runId: "cmd-run-1",
  origin: "command",
  source: "registry",
  sessionId: SESSION_ID,
  sessionFile: null,
  startedAt: "2026-10-27T08:00:01.900Z",
  durationMs: 1200,
  provider: "deepseek",
  modelRequested: "deepseek-flash",
  modelReturned: "deepseek-flash",
  effortRequested: "low",
  effortEffective: null,
  input: 60,
  output: 67,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 9,
  totalTokens: 127,
  costPi: 0.0000984,
  ratesVersion: "test-version",
  status: "ok",
  failureKind: null,
};

async function withFixture<T>(
  run: (ctx: { ledger: ReturnType<typeof openLedger>; root: string }) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "template-new-agent-ingest-"));
  const sessions = path.join(root, "sessions", "--tmp--");
  await mkdir(sessions, { recursive: true });
  const ledger = openLedger(path.join(root, "logs", "ledger.sqlite"));
  try {
    return await run({ ledger, root });
  } finally {
    ledger.close();
    await rm(root, { recursive: true, force: true });
  }
}

describe("session ingest", () => {
  it("turns an assistant message into a chat call with its tokens", async () => {
    await withFixture(async ({ ledger, root }) => {
      const file = path.join(root, "sessions", "--tmp--", `2026-10-27T08-00-00-000Z_${SESSION_ID}.jsonl`);
      await writeFile(
        file,
        [
          line({ type: "session", id: SESSION_ID, timestamp: "2026-10-27T08:00:00.000Z" }),
          line({
            type: "message",
            id: "u1",
            timestamp: "2026-10-27T08:00:01.000Z",
            message: { role: "user", content: [{ type: "text", text: "What is 2+2?" }], timestamp: 1 },
          }),
          line({
            type: "message",
            id: "a1",
            parentId: "u1",
            timestamp: "2026-10-27T08:00:02.000Z",
            message: {
              role: "assistant",
              provider: "deepseek",
              model: "deepseek-flash",
              responseModel: "deepseek-flash",
              thinkingLevel: "low",
              durationMs: 1300,
              stopReason: "stop",
              usage: {
                input: 1062,
                output: 3,
                cacheRead: 0,
                cacheWrite: 0,
                reasoning: 0,
                totalTokens: 1065,
                cost: { input: 0.0003, output: 0.0000036, cacheRead: 0, cacheWrite: 0, total: 0.0003222 },
              },
            },
          }),
        ].join(""),
        "utf8",
      );

      const stats = syncSessions(ledger, { sessionsRoot: path.join(root, "sessions"), ratesVersion: "test-version" });
      assert.equal(stats.newCalls, 1);

      const calls = readCalls(ledger);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].origin, "chat");
      assert.equal(calls[0].source, "session");
      assert.equal(calls[0].totalTokens, 1065);
      assert.equal(calls[0].effortEffective, "low");
      assert.equal(calls[0].durationMs, 1300);
      assert.equal(calls[0].runId, "u1");

      const runs = summarizeRuns(ledger, rates);
      assert.equal(runs.length, 1);
      assert.equal(runs[0].label, "What is 2+2?");
      assert.equal(runs[0].origin, "chat");
      assert.equal(Number(runs[0].costEstimated?.toFixed(8)), 0.0003222);
    });
  });

  it("does not duplicate rows when the same file is read again", async () => {
    await withFixture(async ({ ledger, root }) => {
      const file = path.join(root, "sessions", "--tmp--", `2026-10-27T08-00-00-000Z_${SESSION_ID}.jsonl`);
      await writeFile(file, sessionFile(), "utf8");
      syncSessions(ledger, { sessionsRoot: path.join(root, "sessions"), ratesVersion: "test-version" });
      const first = readCalls(ledger).length;
      const second = syncSessions(ledger, { sessionsRoot: path.join(root, "sessions"), ratesVersion: "test-version" });
      assert.equal(second.files, 0);
      assert.equal(readCalls(ledger).length, first);
    });
  });

  it("reads only the new bytes when a session grows", async () => {
    await withFixture(async ({ ledger, root }) => {
      const file = path.join(root, "sessions", "--tmp--", `2026-10-27T08-00-00-000Z_${SESSION_ID}.jsonl`);
      await writeFile(file, sessionFile(), "utf8");
      syncSessions(ledger, { sessionsRoot: path.join(root, "sessions"), ratesVersion: "test-version" });
      const before = readCalls(ledger).length;

      await writeFile(
        file,
        `${sessionFile()}${line({
          type: "message",
          id: "a9",
          parentId: "c1",
          timestamp: "2026-10-27T08:00:09.000Z",
          message: {
            role: "assistant",
            provider: "deepseek",
            model: "deepseek-flash",
            stopReason: "stop",
            usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 12, cost: { total: 0.000004 } },
          },
        })}`,
        "utf8",
      );
      const stats = syncSessions(ledger, { sessionsRoot: path.join(root, "sessions"), ratesVersion: "test-version" });
      assert.equal(stats.newCalls, 1);
      assert.equal(readCalls(ledger).length, before + 1);
      // The new assistant message still belongs to the run that was open.
      assert.equal(readCalls(ledger).at(-1)?.runId, "u1");
    });
  });

  it("merges a command run into the session turn that launched it", async () => {
    await withFixture(async ({ ledger, root }) => {
      ledger.upsertRun({
        runId: "cmd-run-1",
        sessionId: SESSION_ID,
        startedAt: "2026-10-27T08:00:01.900Z",
        label: "/ask \"what is a vector database?\"",
        origin: "command",
        provider: "deepseek",
        model: "deepseek-flash",
      });
      ledger.insertCall(COMMAND_CALL);

      const file = path.join(root, "sessions", "--tmp--", `2026-10-27T08-00-00-000Z_${SESSION_ID}.jsonl`);
      await writeFile(file, sessionFile(), "utf8");
      assert.equal(readCalls(ledger).length, 1);

      const stats = syncSessions(ledger, { sessionsRoot: path.join(root, "sessions"), ratesVersion: "test-version" });
      assert.equal(stats.merged, 1);
      assert.equal(readCalls(ledger).length, 1, "the call is moved, not duplicated");

      const runs = summarizeRuns(ledger, rates);
      assert.equal(runs.length, 1, "one input is one run");
      assert.equal(runs[0].runId, "u1");
      assert.equal(runs[0].origin, "command");
      assert.equal(runs[0].calls.length, 1);
      assert.equal(runs[0].sessionId, SESSION_ID);
    });
  });

  it("keeps a sessionless command run on its own", async () => {
    await withFixture(async ({ ledger, root }) => {
      ledger.upsertRun({
        runId: "cmd-run-2",
        sessionId: null,
        startedAt: "2026-10-27T09:00:00.000Z",
        label: "from -p with no session",
        origin: "command",
        provider: "openai",
        model: "gpt-5.4",
      });
      ledger.insertCall({ ...COMMAND_CALL, callId: "cmd-run-2", runId: "cmd-run-2", sessionId: null, provider: "openai", modelRequested: "gpt-5.4" });
      syncSessions(ledger, { sessionsRoot: path.join(root, "sessions"), ratesVersion: "test-version" });
      const runs = summarizeRuns(ledger, rates);
      assert.equal(runs.length, 1);
      assert.equal(runs[0].runId, "cmd-run-2");
    });
  });

  it("marks a mixed run when both channels paid", async () => {
    await withFixture(async ({ ledger, root }) => {
      const file = path.join(root, "sessions", "--tmp--", `2026-10-27T08-00-00-000Z_${SESSION_ID}.jsonl`);
      await writeFile(
        file,
        [
          line({ type: "session", id: SESSION_ID, timestamp: "2026-10-27T08:00:00.000Z" }),
          line({
            type: "message",
            id: "u1",
            timestamp: "2026-10-27T08:00:01.000Z",
            message: { role: "user", content: "explain this /ask result", timestamp: 1 },
          }),
          line({
            type: "message",
            id: "a1",
            timestamp: "2026-10-27T08:00:02.000Z",
            message: {
              role: "assistant",
              provider: "deepseek",
              model: "deepseek-flash",
              stopReason: "stop",
              usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 110, cost: { total: 0.000042 } },
            },
          }),
        ].join(""),
        "utf8",
      );
      syncSessions(ledger, { sessionsRoot: path.join(root, "sessions"), ratesVersion: "test-version" });
      ledger.insertCall({ ...COMMAND_CALL, callId: "extra", runId: "u1", sessionId: SESSION_ID });

      const runs = summarizeRuns(ledger, rates);
      assert.equal(runs.length, 1);
      assert.equal(runs[0].origin, "mixed");
      assert.equal(runs[0].calls.length, 2);
    });
  });
});
