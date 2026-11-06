import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { Api, AssistantMessage, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import { resolveModel, runAsk, type RegistryLike } from "../src/ask.ts";
import { parseRateCard, versionOf } from "../ledger/rates.ts";
import { openLedger, readCalls } from "../ledger/store.ts";

const MODEL = {
  provider: "deepseek",
  id: "deepseek-flash",
  name: "DeepSeek Flash",
} as unknown as Model<Api>;

const OTHER = {
  provider: "openai",
  id: "gpt-5.4",
  name: "GPT-5.4",
} as unknown as Model<Api>;

function registry(options: { message?: AssistantMessage; throws?: Error; auth?: boolean } = {}): RegistryLike {
  return {
    find(provider, id) {
      return [MODEL, OTHER].find((model) => model.provider === provider && model.id === id);
    },
    getAvailable: () => [MODEL, OTHER],
    hasConfiguredAuth: () => options.auth ?? true,
    streamSimple() {
      return {
        async result() {
          if (options.throws) throw options.throws;
          return options.message ?? message();
        },
      } as unknown as AssistantMessageEventStream;
    },
  };
}

function message(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "pong" }],
    api: "openai-completions" as AssistantMessage["api"],
    provider: "deepseek",
    model: "deepseek-flash",
    usage: {
      input: 1062,
      output: 3,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      totalTokens: 1065,
      cost: { input: 0.0003186, output: 0.0000036, cacheRead: 0, cacheWrite: 0, total: 0.0003222 },
    },
    stopReason: "stop",
    timestamp: Date.parse("2026-10-27T08:00:00.000Z"),
    durationMs: 1285,
    ...overrides,
  };
}

const CARD = parseRateCard(
  JSON.stringify({
    schemaVersion: 1,
    currency: "USD",
    unit: "per_million_tokens",
    updatedAt: "2026-10-27T08:00:00Z",
    models: { "deepseek-flash": [{ effectiveFrom: "2026-01-01T00:00:00Z", input: 0.3, output: 1.2, cacheRead: 0.006 }] },
  }),
);

const rates = {
  source: "file" as const,
  updatedAt: CARD.updatedAt,
  version: versionOf(CARD.models),
  models: CARD.models,
};

async function withLedger<T>(run: (ledger: ReturnType<typeof openLedger>, env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "keep-agent-"));
  const ledger = openLedger(path.join(root, "logs", "ledger.sqlite"));
  try {
    return await run(ledger, { PI_CODING_AGENT_DIR: path.join(root, "keep-agent") });
  } finally {
    ledger.close();
    await rm(root, { recursive: true, force: true });
  }
}

describe("runAsk", () => {
  it("records a priced call with tokens, both cost figures, and the rate version", async () => {
    await withLedger(async (ledger, env) => {
      const outcome = await runAsk(
        { question: "say pong", model: "deepseek-flash", effort: "low" },
        { registry: registry(), ledger, rates, env },
      );
      assert.equal(outcome.status, "ok");
      assert.equal(outcome.text, "pong");
      assert.deepEqual(outcome.tokens, {
        input: 1062,
        output: 3,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        total: 1065,
      });
      // 1,062 input at 0.30/M plus 3 output at 1.20/M.
      assert.equal(Number(outcome.costEstimated?.toFixed(8)), 0.0003222);
      assert.equal(outcome.costPi, 0.0003222);
      assert.equal(outcome.durationMs, 1285);

      const rows = readCalls(ledger);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].origin, "command");
      assert.equal(rows[0].source, "registry");
      assert.equal(rows[0].ratesVersion, rates.version);
      assert.equal(rows[0].status, "ok");
      assert.equal(rows[0].modelRequested, "deepseek-flash");
      assert.equal(rows[0].effortEffective, null);
    });
  });

  it("labels the run with the first line only", async () => {
    await withLedger(async (ledger, env) => {
      const outcome = await runAsk(
        { question: "first line\nsecond line", model: "deepseek-flash" },
        { registry: registry(), ledger, rates, env },
      );
      const row = ledger.db.prepare("SELECT label FROM runs WHERE run_id = ?").get(outcome.runId) as { label: string };
      assert.equal(row.label, "first line");
    });
  });

  it("records a failed attempt and returns the reason instead of throwing", async () => {
    await withLedger(async (ledger, env) => {
      const outcome = await runAsk(
        { question: "say pong", model: "deepseek-flash" },
        { registry: registry({ throws: new Error("connection reset") }), ledger, rates, env },
      );
      assert.equal(outcome.status, "failed");
      assert.equal(outcome.failure, "connection reset");
      const rows = readCalls(ledger);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "failed");
      assert.equal(rows[0].failureKind, "provider_error");
      assert.equal(rows[0].totalTokens, 0);
    });
  });

  it("refuses to run without a configured key, and records nothing", async () => {
    await withLedger(async (ledger, env) => {
      await assert.rejects(
        runAsk({ question: "hi", model: "deepseek-flash" }, { registry: registry({ auth: false }), ledger, rates, env }),
        /No API key configured/,
      );
      assert.equal(readCalls(ledger).length, 0);
    });
  });

  it("marks a provider error stop as a failure", async () => {
    await withLedger(async (ledger, env) => {
      const outcome = await runAsk(
        { question: "hi", model: "deepseek-flash" },
        {
          registry: registry({ message: message({ stopReason: "error", errorMessage: "rate limited" }) }),
          ledger,
          rates,
          env,
        },
      );
      assert.equal(outcome.status, "failed");
      assert.equal(outcome.failure, "rate limited");
    });
  });

  it("reports an unrated model as unrated rather than free", async () => {
    await withLedger(async (ledger, env) => {
      const outcome = await runAsk(
        { question: "hi", model: "gpt-5.4" },
        { registry: registry({ message: message({ provider: "openai", model: "gpt-5.4" }) }), ledger, rates, env },
      );
      assert.equal(outcome.costEstimated, null);
      assert.equal(outcome.costPi, 0.0003222);
    });
  });
});

describe("resolveModel", () => {
  it("takes provider/id", () => {
    assert.equal(resolveModel(registry(), undefined, "openai/gpt-5.4").id, "gpt-5.4");
  });

  it("finds a unique bare id", () => {
    assert.equal(resolveModel(registry(), undefined, "gpt-5.4").provider, "openai");
  });

  it("honours an explicit provider", () => {
    assert.equal(resolveModel(registry(), "deepseek", "deepseek-flash").provider, "deepseek");
  });

  it("names the alternatives when the model is unknown", () => {
    assert.throws(() => resolveModel(registry(), undefined, "nope"), /Unknown model "nope"\. Available: deepseek-flash, gpt-5\.4/);
  });

  it("refuses a provider without a model", () => {
    assert.throws(() => resolveModel(registry(), "openai", undefined), /--provider needs --model/);
  });

  it("names settings.json when nothing is chosen", () => {
    assert.throws(() => resolveModel(registry(), undefined, undefined), /set defaultProvider and defaultModel in settings\.json/);
  });
});
