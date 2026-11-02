import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRateCard, versionOf } from "../ledger/rates.ts";
import { pickRate } from "../ledger/rate-table.ts";
import { estimateCost } from "../ledger/tokens.ts";

function card(input = 2.5, second = 5, schemaVersion = 1): string {
  return JSON.stringify({
    schemaVersion,
    currency: "USD",
    unit: "per_million_tokens",
    updatedAt: "2026-10-27T08:00:00Z",
    models: {
      "gpt-5.4": [
        { effectiveFrom: "2026-01-01T00:00:00Z", input, output: 15, cacheRead: 0.25 },
        { effectiveFrom: "2026-06-01T00:00:00Z", input: second, output: 30, cacheRead: 0.5, source: "price rise" },
      ],
    },
  });
}

const TOKENS = { input: 10_000, output: 1_000, cacheRead: 40_000, cacheWrite: 0, reasoning: 0, total: 51_000 };
const parsed = parseRateCard(card());
const rates = {
  source: "file" as const,
  updatedAt: parsed.updatedAt,
  version: versionOf(parsed.models),
  models: parsed.models,
};

describe("rate card", () => {
  it("picks the entry in force at the call time", () => {
    assert.equal(pickRate(parsed.models["gpt-5.4"], "2026-03-01T00:00:00Z")?.input, 2.5);
    assert.equal(pickRate(parsed.models["gpt-5.4"], "2026-09-01T00:00:00Z")?.input, 5);
  });

  it("has no entry before the first effective date", () => {
    assert.equal(pickRate(parsed.models["gpt-5.4"], "2025-12-31T00:00:00Z"), undefined);
  });

  it("prices the same tokens differently after a rate change, without touching the stored row", () => {
    const before = estimateCost(TOKENS, "gpt-5.4", rates, "2026-03-01T00:00:00Z");
    const after = estimateCost(TOKENS, "gpt-5.4", rates, "2026-09-01T00:00:00Z");
    assert.ok(before && after);
    assert.equal(Number(before.total.toFixed(6)), 0.05);
    assert.equal(Number(after.total.toFixed(6)), 0.1);
  });

  it("returns null for an unknown model instead of guessing zero", () => {
    assert.equal(estimateCost(TOKENS, "no-such-model", rates, "2026-03-01T00:00:00Z"), null);
  });

  it("changes the version when a rate changes", () => {
    assert.notEqual(versionOf(parsed.models), versionOf(parseRateCard(card(2.5, 6)).models));
  });

  it("rejects a wrong schema version", () => {
    assert.throws(() => parseRateCard(card(2.5, 5, 2)), /schemaVersion must be 1/);
  });

  it("rejects two entries for the same instant", () => {
    const duplicate = JSON.parse(card()) as { models: Record<string, Array<Record<string, unknown>>> };
    duplicate.models["gpt-5.4"][1].effectiveFrom = "2026-01-01T00:00:00Z";
    assert.throws(() => parseRateCard(JSON.stringify(duplicate)), /two entries/);
  });

  it("rejects a negative price", () => {
    assert.throws(() => parseRateCard(card(-1)), /zero or higher/);
  });

  it("rejects a card that is not JSON", () => {
    assert.throws(() => parseRateCard("{ nope"), SyntaxError);
  });
});
