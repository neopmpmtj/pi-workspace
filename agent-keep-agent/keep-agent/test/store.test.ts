import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openLedger, readCalls, type CallRecord } from "../ledger/store.ts";

const CALL: CallRecord = {
  callId: "call-1",
  runId: "run-1",
  origin: "command",
  source: "registry",
  sessionId: "session-1",
  sessionFile: null,
  startedAt: "2026-10-27T08:00:00.000Z",
  durationMs: 1285,
  provider: "deepseek",
  modelRequested: "deepseek-flash",
  modelReturned: "deepseek-flash",
  effortRequested: "low",
  effortEffective: "low",
  input: 1062,
  output: 3,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  totalTokens: 1065,
  costPi: 0.0003222,
  ratesVersion: "abc123",
  status: "ok",
  failureKind: null,
};

describe("ledger store", () => {
  it("writes a call, assigns a sequence, and reads it back", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "keep-agent-"));
    const ledger = openLedger(path.join(root, "logs", "ledger.sqlite"));
    try {
      ledger.upsertRun({
        runId: "run-1",
        sessionId: "session-1",
        startedAt: CALL.startedAt,
        label: "say pong",
        origin: "command",
        provider: "deepseek",
        model: "deepseek-flash",
      });
      assert.equal(ledger.insertCall(CALL), true);
      const rows = readCalls(ledger);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].seq, 1);
      assert.equal(rows[0].modelRequested, "deepseek-flash");
      assert.equal(rows[0].totalTokens, 1065);
      assert.equal(rows[0].costPi, 0.0003222);
      assert.equal(rows[0].ratesVersion, "abc123");
    } finally {
      ledger.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores a repeated call id, so re-reading a session cannot duplicate rows", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "keep-agent-"));
    const ledger = openLedger(path.join(root, "logs", "ledger.sqlite"));
    try {
      assert.equal(ledger.insertCall(CALL), true);
      assert.equal(ledger.insertCall(CALL), false);
      assert.equal(readCalls(ledger).length, 1);
    } finally {
      ledger.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps one run row and updates it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "keep-agent-"));
    const ledger = openLedger(path.join(root, "logs", "ledger.sqlite"));
    try {
      const run = {
        runId: "run-1",
        sessionId: null,
        startedAt: CALL.startedAt,
        label: "first",
        origin: "command" as const,
        provider: "deepseek",
        model: "deepseek-flash",
      };
      ledger.upsertRun(run);
      ledger.upsertRun({ ...run, label: "second" });
      const row = ledger.db.prepare("SELECT label FROM runs WHERE run_id = ?").get("run-1") as { label: string };
      assert.equal(row.label, "second");
      assert.equal(Number((ledger.db.prepare("SELECT COUNT(*) AS n FROM runs").get() as { n: number }).n), 1);
    } finally {
      ledger.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
