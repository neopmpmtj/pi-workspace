import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openLedger, type CallRecord, type Ledger } from "../ledger/store.ts";
import type { RatesSnapshot } from "../ledger/rate-table.ts";
import { usageHelp, usageView } from "../src/usage.ts";

const rates: RatesSnapshot = {
  source: "file",
  updatedAt: "2026-10-27T08:00:00Z",
  version: "v1",
  models: {
    "deepseek-flash": [{ effectiveFrom: "2026-01-01T00:00:00Z", input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 }],
    "gpt-5.4": [{ effectiveFrom: "2026-01-01T00:00:00Z", input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 }],
  },
};

function call(overrides: Partial<CallRecord>): CallRecord {
  return {
    callId: "c1",
    runId: "run-1",
    origin: "command",
    source: "registry",
    sessionId: "s1",
    sessionFile: null,
    startedAt: "2026-10-27T08:00:00.000Z",
    durationMs: 1000,
    provider: "deepseek",
    modelRequested: "deepseek-flash",
    modelReturned: "deepseek-flash",
    effortRequested: null,
    effortEffective: null,
    input: 1_000_000,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    totalTokens: 1_000_000,
    costPi: 0.3,
    ratesVersion: "v1",
    status: "ok",
    failureKind: null,
    ...overrides,
  };
}

async function withLedger<T>(run: (ledger: Ledger) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "keep-agent-usage-"));
  const ledger = openLedger(path.join(root, "ledger.sqlite"));
  try {
    return await run(ledger);
  } finally {
    ledger.close();
    await rm(root, { recursive: true, force: true });
  }
}

describe("usageView", () => {
  it("reports no runs on an empty ledger", async () => {
    await withLedger(async (ledger) => {
      assert.match(usageView(ledger, rates, { kind: "last" }).text, /No runs yet/);
      assert.match(usageView(ledger, rates, { kind: "all" }).text, /No calls yet/);
    });
  });

  it("shows the last run with one line per call and a total", async () => {
    await withLedger(async (ledger) => {
      ledger.upsertRun({
        runId: "run-1",
        sessionId: "s1",
        startedAt: "2026-10-27T08:00:00.000Z",
        label: "hello",
        origin: "command",
        provider: "deepseek",
        model: "deepseek-flash",
      });
      ledger.insertCall(call({ callId: "c1" }));
      const text = usageView(ledger, rates, { kind: "last" }).text;
      assert.match(text, /command · deepseek\/deepseek-flash/);
      assert.match(text, /est \$0\.3000/);
      assert.match(text, /total/);
    });
  });

  it("totals per model across runs", async () => {
    await withLedger(async (ledger) => {
      for (const [index, model] of [["deepseek-flash", "deepseek"], ["gpt-5.4", "openai"]] as const) {
        ledger.upsertRun({
          runId: `run-${index}`,
          sessionId: "s1",
          startedAt: `2026-10-27T08:0${index}:00.000Z`,
          label: index,
          origin: "command",
          provider: model,
          model: index,
        });
        ledger.insertCall(
          call({ callId: `c-${index}`, runId: `run-${index}`, provider: model, modelRequested: index, costPi: 1 }),
        );
      }
      const text = usageView(ledger, rates, { kind: "all" }).text;
      assert.match(text, /deepseek\/deepseek-flash/);
      assert.match(text, /openai\/gpt-5\.4/);
      assert.match(text, /2,000,000 tokens/);
    });
  });

  it("filters to the current session", async () => {
    await withLedger(async (ledger) => {
      ledger.upsertRun({
        runId: "run-1",
        sessionId: "s1",
        startedAt: "2026-10-27T08:00:00.000Z",
        label: "mine",
        origin: "command",
        provider: "deepseek",
        model: "deepseek-flash",
      });
      ledger.insertCall(call({ callId: "c1" }));
      ledger.upsertRun({
        runId: "run-2",
        sessionId: "other",
        startedAt: "2026-10-27T08:01:00.000Z",
        label: "not mine",
        origin: "chat",
        provider: "deepseek",
        model: "deepseek-flash",
      });
      ledger.insertCall(call({ callId: "c2", runId: "run-2", sessionId: "other" }));

      const mine = usageView(ledger, rates, { kind: "session", sessionId: "s1" });
      assert.equal(mine.runs.length, 1);
      assert.match(mine.text, /mine/);
      assert.doesNotMatch(mine.text, /not mine/);
    });
  });

  it("finds a run by id prefix", async () => {
    await withLedger(async (ledger) => {
      ledger.upsertRun({
        runId: "abcdef12-3456",
        sessionId: "s1",
        startedAt: "2026-10-27T08:00:00.000Z",
        label: "the run",
        origin: "command",
        provider: "deepseek",
        model: "deepseek-flash",
      });
      ledger.insertCall(call({ callId: "c1", runId: "abcdef12-3456" }));
      assert.match(usageView(ledger, rates, { kind: "run", prefix: "abcdef" }).text, /the run/);
      assert.match(usageView(ledger, rates, { kind: "run", prefix: "zzz" }).text, /No run starts with/);
    });
  });
});

describe("usageHelp", () => {
  it("prints help for --help and ignores the other flags", () => {
    const alone = usageHelp("--help");
    const withAll = usageHelp("--help --all");
    assert.equal(usageHelp("--all"), undefined);
    assert.ok(alone);
    assert.equal(withAll, alone);
    assert.match(alone, /--session/);
  });
});
