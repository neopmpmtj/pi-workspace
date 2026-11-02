import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { syncToolCalls } from "../ledger/search-ingest.ts";
import { openLedger, type Ledger } from "../ledger/store.ts";
import { BUILT_IN, parseToolRates, versionOf, toolCost } from "../ledger/tool-rates.ts";
import { readToolCalls } from "../ledger/tool-store.ts";

const SESSION_ID = "01a17ce3-731e-7528-ba1f-0a97aee52da8";

function line(entry: unknown): string {
  return `${JSON.stringify(entry)}\n`;
}

function toolResult(overrides: Record<string, unknown> = {}): string {
  return line({
    type: "message",
    id: "r1",
    timestamp: "2026-10-27T10:24:07.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "web_search",
      isError: false,
      durationMs: 1830,
      details: {
        queryCount: 2,
        totalResults: 12,
        queryProviders: [
          { query: "node lts", providers: ["brave"] },
          { query: "node release schedule", providers: ["exa"] },
        ],
      },
      ...overrides,
    },
  });
}

async function withFixture<T>(
  run: (ctx: { ledger: Ledger; root: string; file: string }) => Promise<T>,
  body = [line({ type: "session", id: SESSION_ID, timestamp: "2026-10-27T10:24:03.000Z" }), toolResult()].join(""),
): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "web-master-tools-"));
  const dir = path.join(root, "sessions", "--tmp--");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `2026-10-27T10-24-03-000Z_${SESSION_ID}.jsonl`);
  await writeFile(file, body, "utf8");
  const ledger = openLedger(path.join(root, "logs", "ledger.sqlite"));
  try {
    return await run({ ledger, root, file });
  } finally {
    ledger.close();
    await rm(root, { recursive: true, force: true });
  }
}

const rates = BUILT_IN;

describe("tool cost", () => {
  it("prices each provider in a mixed call", () => {
    const cost = toolCost({ brave: 1, exa: 1 }, rates);
    assert.equal(Number(cost.total.toFixed(6)), 0.005);
    assert.equal(cost.status, "rated");
  });

  it("never treats an unknown provider as free", () => {
    const cost = toolCost({ mystery: 2 }, rates);
    assert.equal(cost.status, "unrated");
    assert.deepEqual(cost.unrated, ["mystery"]);
  });

  it("marks a model-backed provider as partial, because its tokens are unseen", () => {
    const cost = toolCost({ gemini: 1 }, rates);
    assert.equal(cost.status, "partial");
    assert.deepEqual(cost.unmetered, ["gemini"]);
    assert.equal(Number(cost.total.toFixed(6)), 0.014);
  });

  it("reads a card and versions it by content", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      currency: "USD",
      unit: "per_search",
      updatedAt: "2026-10-27T10:00:00Z",
      providers: { brave: { perSearch: 0.004 } },
      fetch: { perUrl: 0 },
    });
    const parsed = parseToolRates(text);
    assert.equal(parsed.providers.brave.perSearch, 0.004);
    assert.notEqual(versionOf(parsed.providers, parsed.fetch), versionOf(BUILT_IN.providers, BUILT_IN.fetch));
  });

  it("rejects a negative price", () => {
    assert.throws(
      () =>
        parseToolRates(
          JSON.stringify({ schemaVersion: 1, currency: "USD", unit: "per_search", providers: { brave: { perSearch: -1 } } }),
        ),
      /zero or higher/,
    );
  });
});

describe("search ingest", () => {
  it("prices a two-provider search and links it to the run", async () => {
    await withFixture(async ({ ledger, root }) => {
      ledger.upsertRun({
        runId: "u1",
        sessionId: SESSION_ID,
        startedAt: "2026-10-27T10:24:03.000Z",
        label: "search for node lts",
        origin: "chat",
        provider: "openai",
        model: "gpt-4.1-mini",
      });
      const stats = syncToolCalls(ledger, { sessionsRoot: path.join(root, "sessions"), rates });
      assert.equal(stats.newCalls, 1);
      assert.equal(stats.searches, 2);

      const rows = readToolCalls(ledger, rates);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].tool, "web_search");
      assert.equal(rows[0].searches, 2);
      assert.equal(rows[0].results, 12);
      assert.equal(rows[0].durationMs, 1830);
      assert.deepEqual(rows[0].providerCounts, { brave: 1, exa: 1 });
      assert.equal(Number(rows[0].costEstimated.toFixed(6)), 0.005);
      assert.equal(rows[0].costStatus, "rated");
      assert.equal(rows[0].runId, "u1");
    });
  });

  it("does not duplicate a call when the file is read twice", async () => {
    await withFixture(async ({ ledger, root }) => {
      syncToolCalls(ledger, { sessionsRoot: path.join(root, "sessions"), rates });
      const second = syncToolCalls(ledger, { sessionsRoot: path.join(root, "sessions"), rates });
      assert.equal(second.files, 0);
      assert.equal(readToolCalls(ledger, rates).length, 1);
    });
  });

  it("reads only new bytes when a session grows", async () => {
    await withFixture(async ({ ledger, root, file }) => {
      syncToolCalls(ledger, { sessionsRoot: path.join(root, "sessions"), rates });
      await writeFile(
        file,
        `${await (await import("node:fs/promises")).readFile(file, "utf8")}${toolResult({
          toolCallId: "call-2",
          toolName: "fetch_content",
          details: { urls: ["https://a", "https://b"], urlCount: 2 },
        })}`,
        "utf8",
      );
      const stats = syncToolCalls(ledger, { sessionsRoot: path.join(root, "sessions"), rates });
      assert.equal(stats.newCalls, 1);
      const rows = readToolCalls(ledger, rates);
      assert.equal(rows.length, 2);
      const fetch = rows.find((row) => row.kind === "fetch");
      assert.ok(fetch);
      assert.equal(fetch.urls, 2);
      assert.equal(fetch.costEstimated, 0);
    });
  });

  it("ignores free retrieval tools", async () => {
    await withFixture(
      async ({ ledger, root }) => {
        const stats = syncToolCalls(ledger, { sessionsRoot: path.join(root, "sessions"), rates });
        assert.equal(stats.newCalls, 0);
        assert.equal(readToolCalls(ledger, rates).length, 0);
      },
      [line({ type: "session", id: SESSION_ID }), toolResult({ toolCallId: "c9", toolName: "get_search_content" })].join(""),
    );
  });

  it("marks a provider the card does not know as unrated, not free", async () => {
    await withFixture(
      async ({ ledger, root }) => {
        syncToolCalls(ledger, { sessionsRoot: path.join(root, "sessions"), rates });
        const rows = readToolCalls(ledger, rates);
        assert.equal(rows[0].costStatus, "unrated");
        assert.deepEqual(rows[0].unratedProviders, ["kagi"]);
      },
      [
        line({ type: "session", id: SESSION_ID }),
        toolResult({ details: { queryCount: 1, queryProviders: [{ query: "x", providers: ["kagi"] }] } }),
      ].join(""),
    );
  });
});
