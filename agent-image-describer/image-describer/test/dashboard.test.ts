import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { readFile, unlink, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";
import { completeLines, sessionChatPoints, parseSessionLine, type ChatPoint, type ImagePoint } from "../dashboard/parse.ts";
import { sessionBars } from "../dashboard/session-cost.ts";
import { builtInRates, rateAt, rateLookup, type ModelRate, type RateLookup, type RatesSnapshot, type RateTable } from "../dashboard/src/rates.ts";
import { modelRatesPath, parseModelRates } from "../src/model-rates.ts";
import { startDashboard } from "../dashboard/server.ts";
import { modeSwitches } from "../src/default-mode.ts";
import { BUILT_IN_PROMPTS, OUTPUT_SHAPE, PROMPT_MODES, PROMPT_RULES } from "../src/prompt.ts";
import { chatCalls, imageCalls, insertChatCalls, insertImageCalls, withMetrics } from "../src/metrics.ts";
import { removeDir, tempDir } from "./helpers.ts";

describe("dashboard parsers", () => {
  test("drops a trailing partial line", () => {
    assert.deepEqual(completeLines('{"filename":"half'), []);
    const text = `${JSON.stringify({ type: "session", id: "s" })}\n{"type":"message"`;
    assert.equal(sessionChatPoints(text).length, 0);
  });

  test("parses an assistant chat cost and keeps the session id", () => {
    const point = parseSessionLine(assistantLine(0.000171156));
    assert.ok(point);
    assert.equal(point.id, "msg-1");
    assert.equal(point.recordedAt, "2026-10-22T18:27:08.022Z");
    assert.equal(point.model, "deepseek-flash");
    assert.equal(point.provider, "deepseek");
    assert.equal(point.costTotal, 0.000171156);
    assert.equal(point.inputTokens, 367);
    assert.equal(point.outputTokens, 40);
    assert.equal(point.cacheReadTokens, null);
    assert.equal(point.cacheWriteTokens, null);
    assert.equal(point.reasoningTokens, null);

    const cached = parseSessionLine(assistantLine(0.000171156, {
      input: 10,
      output: 4,
      cacheRead: 8,
      cacheWrite: 1,
      reasoning: 2,
    }));
    assert.equal(cached?.inputTokens, 10);
    assert.equal(cached?.outputTokens, 4);
    assert.equal(cached?.cacheReadTokens, 8);
    assert.equal(cached?.cacheWriteTokens, 1);
    assert.equal(cached?.reasoningTokens, 2);

    const points = sessionChatPoints(`${sessionHeader("sess-1")}\n${assistantLine(0.000171156)}\n`);
    assert.equal(points.length, 1);
    assert.equal(points[0]?.sessionId, "sess-1");
    assert.equal(points[0]?.costTotal, 0.000171156);
    assert.equal(points[0]?.inputTokens, 367);
  });

  test("ignores session records that are not an assistant cost", () => {
    const records = [
      { type: "session", id: "s" },
      { type: "message", id: "u", message: { role: "user", content: "hello" } },
      { type: "message", id: "a", message: { role: "assistant", content: "hi" } },
      { type: "custom_message", customType: "describe-images", content: "saved" },
      "not json",
    ];
    const text = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
    assert.deepEqual(sessionChatPoints(text), []);
    assert.equal(parseSessionLine(JSON.stringify(records[2])), null);
  });
});

describe("metrics database", () => {
  test("creates an empty database and ignores a second insert of the same image", async () => {
    const dir = await tempDir();
    try {
      const file = path.join(dir, "logs", "metrics.sqlite");
      assert.equal(existsSync(file), false);
      assert.deepEqual(imageCalls(file), []);
      assert.equal(existsSync(file), true);
      const row = imageRow();
      insertImageCalls(file, [row]);
      insertImageCalls(file, [row]);
      const stored = imageCalls(file);
      assert.equal(stored.length, 1);
      assert.equal(stored[0]?.filename, "a.jpg");
      assert.equal(stored[0]?.mode, "general");
      assert.equal(stored[0]?.effort, "none");
      assert.equal(stored[0]?.language, "English");
      assert.equal(stored[0]?.totalTokens, 100);
    } finally {
      await removeDir(dir);
    }
  });

  test("keeps a chat row after the session file is deleted and drops it with the database", async () => {
    const dir = await tempDir();
    try {
      const file = path.join(dir, "logs", "metrics.sqlite");
      const sessionFile = path.join(dir, "sessions", "chat.jsonl");
      await mkdir(path.dirname(sessionFile), { recursive: true });
      const text = `${sessionHeader("sess-9")}\n${assistantLine(0.25)}\n`;
      await writeFile(sessionFile, text);
      withMetrics(file, (db) => {
        insertChatCalls(db, sessionChatPoints(text));
        insertChatCalls(db, sessionChatPoints(text));
      });
      await unlink(sessionFile);
      const kept = chatCalls(file);
      assert.equal(kept.length, 1);
      assert.equal(kept[0]?.id, "msg-1");
      assert.equal(kept[0]?.sessionId, "sess-9");
      assert.equal(kept[0]?.costTotal, 0.25);
      assert.equal(kept[0]?.inputTokens, 367);
      await removeDatabase(file);
      assert.deepEqual(chatCalls(file), []);
      assert.deepEqual(imageCalls(file), []);
    } finally {
      await removeDir(dir);
    }
  });

  test("fills token columns when the same chat row is stored again", async () => {
    const dir = await tempDir();
    try {
      const file = path.join(dir, "logs", "metrics.sqlite");
      const bare = `${sessionHeader("sess-9")}\n${assistantLine(0.25, null)}\n`;
      const priced = `${sessionHeader("sess-9")}\n${assistantLine(0.25, {
        input: 10,
        output: 4,
        cacheRead: 8,
        cacheWrite: 1,
        reasoning: 2,
      })}\n`;
      withMetrics(file, (db) => {
        insertChatCalls(db, sessionChatPoints(bare));
        insertChatCalls(db, sessionChatPoints(priced));
      });
      const kept = chatCalls(file);
      assert.equal(kept.length, 1);
      assert.equal(kept[0]?.inputTokens, 10);
      assert.equal(kept[0]?.outputTokens, 4);
      assert.equal(kept[0]?.cacheReadTokens, 8);
      assert.equal(kept[0]?.cacheWriteTokens, 1);
      assert.equal(kept[0]?.reasoningTokens, 2);
    } finally {
      await removeDir(dir);
    }
  });

  test("adds the effort column to an image table created without it", async () => {
    const dir = await tempDir();
    try {
      const file = path.join(dir, "logs", "metrics.sqlite");
      await mkdir(path.dirname(file), { recursive: true });
      const db = new DatabaseSync(file);
      db.exec(`CREATE TABLE image_calls (
        run_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        session_id TEXT,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        duration_seconds REAL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        reasoning_tokens INTEGER,
        cached_tokens INTEGER,
        PRIMARY KEY (run_id, filename)
      )`);
      db.prepare(`INSERT INTO image_calls (
        run_id, filename, recorded_at, session_id, model, provider, mode, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        "run-1",
        "a.jpg",
        "2026-10-23T00:00:00.000Z",
        null,
        "deepseek-flash",
        "deepseek",
        "general",
        "succeeded",
      );
      db.close();
      const stored = imageCalls(file);
      assert.equal(stored.length, 1);
      assert.equal(stored[0]?.mode, "general");
      assert.equal(stored[0]?.effort, "");
      insertImageCalls(file, [image({ runId: "run-2", filename: "b.jpg", mode: "detailed", effort: "medium" })]);
      const rows = imageCalls(file);
      assert.equal(rows.find((row) => row.filename === "a.jpg")?.effort, "");
      assert.equal(rows.find((row) => row.filename === "a.jpg")?.language, "");
      const added = rows.find((row) => row.filename === "b.jpg");
      assert.equal(added?.effort, "medium");
      assert.equal(added?.language, "English");
    } finally {
      await removeDir(dir);
    }
  });

  test("adds chat token columns to a database created without them", async () => {
    const dir = await tempDir();
    try {
      const file = path.join(dir, "logs", "metrics.sqlite");
      await mkdir(path.dirname(file), { recursive: true });
      const db = new DatabaseSync(file);
      db.exec(`CREATE TABLE chat_calls (
        id TEXT NOT NULL PRIMARY KEY,
        recorded_at TEXT NOT NULL,
        session_id TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        cost_total REAL NOT NULL
      )`);
      db.prepare(`INSERT INTO chat_calls (id, recorded_at, session_id, provider, model, cost_total)
        VALUES (?, ?, ?, ?, ?, ?)`).run("msg-1", "2026-10-22T18:27:08.022Z", "sess-9", "deepseek", "deepseek-flash", 0.25);
      db.close();
      const kept = chatCalls(file);
      assert.equal(kept.length, 1);
      assert.equal(kept[0]?.costTotal, 0.25);
      assert.equal(kept[0]?.inputTokens, null);
      const names = withMetrics(file, (open) => open.prepare("PRAGMA table_info(chat_calls)").all().map((row) => {
        const name = (row as { name?: unknown }).name;
        return typeof name === "string" ? name : "";
      }));
      for (const column of ["input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "reasoning_tokens"]) {
        assert.ok(names.includes(column));
      }
    } finally {
      await removeDir(dir);
    }
  });
});

describe("session cost", () => {
  test("sums image tokens times a rate with chat cost for one session", () => {
    const bars = sessionBars(
      [
        image({ sessionId: "sess", filename: "a.jpg", inputTokens: 100, outputTokens: 0, cachedTokens: 0, totalTokens: 100 }),
        image({ sessionId: "sess", filename: "b.jpg", inputTokens: 40, outputTokens: 10, cachedTokens: 0, totalTokens: 50 }),
      ],
      [chat({ sessionId: "sess", costTotal: 0.5 })],
      flatRates({ "deepseek-flash": { input: 1_000_000, output: 1_000_000, cacheRead: 0 } }),
    );
    assert.equal(bars.length, 1);
    assert.equal(bars[0]?.description.tokens, 150);
    assert.equal(bars[0]?.description.cost, 150);
    assert.equal(bars[0]?.chat.cost, 0.5);
    assert.equal(bars[0]?.chat.tokens, 0);
    assert.equal(bars[0]?.chatEstimated, true);
    assert.equal(bars[0]?.totalCost, 150.5);
    assert.equal(bars[0]?.rateUnset, false);
  });

  test("shows an image-only session and leaves dollars unset when the rate is missing", () => {
    const bars = sessionBars(
      [image({ sessionId: "only", inputTokens: 10, outputTokens: 0, cachedTokens: 0, totalTokens: 10 })],
      [],
      flatRates({}),
    );
    assert.equal(bars.length, 1);
    assert.equal(bars[0]?.id, "session:only");
    assert.equal(bars[0]?.description.tokens, 10);
    assert.equal(bars[0]?.description.cost, 0);
    assert.equal(bars[0]?.chat.cost, 0);
    assert.equal(bars[0]?.totalCost, 0);
    assert.equal(bars[0]?.rateUnset, true);
  });

  test("uses the run id when an image has no session", () => {
    const bars = sessionBars(
      [image({ runId: "run-7", inputTokens: 4, outputTokens: 0, cachedTokens: 0, totalTokens: 4 })],
      [],
      flatRates({ "deepseek-flash": { input: 2_000_000, output: 0, cacheRead: 0 } }),
    );
    assert.equal(bars[0]?.id, "run:run-7");
    assert.equal(bars[0]?.description.cost, 8);
  });

  test("prices a deepseek image from input, cached, and output rates and adds the chat cost", () => {
    const bars = sessionBars(
      [image({
        sessionId: "01a167c1-e0cd-75f8-b6f4-0640811248d5",
        inputTokens: 1104,
        outputTokens: 474,
        cachedTokens: 896,
        totalTokens: 1578,
      })],
      [chat({
        sessionId: "01a167c1-e0cd-75f8-b6f4-0640811248d5",
        costTotal: 0.000988452,
        inputTokens: 1163,
        outputTokens: 476,
        cacheReadTokens: 11392,
        cacheWriteTokens: 0,
        reasoningTokens: 6,
      })],
      rateLookup(builtInRates),
    );
    assert.equal(bars.length, 1);
    assert.equal(bars[0]?.description.uncachedInput, 208);
    assert.equal(bars[0]?.description.cachedInput, 896);
    assert.equal(bars[0]?.description.output, 474);
    assert.equal(bars[0]?.description.tokens, 1578);
    assert.equal(bars[0]?.chat.uncachedInput, 1163);
    assert.equal(bars[0]?.chat.cachedInput, 11392);
    assert.equal(bars[0]?.chat.output, 476);
    assert.equal(bars[0]?.chatEstimated, false);
    assert.ok(Math.abs((bars[0]?.description.cost ?? 0) - 0.000636576) < 1e-12);
    assert.ok(Math.abs((bars[0]?.chat.cost ?? 0) - 0.000988452) < 1e-12);
    assert.ok(Math.abs((bars[0]?.chatRecordedCost ?? 0) - 0.000988452) < 1e-12);
    assert.ok(Math.abs((bars[0]?.totalCost ?? 0) - 0.001625028) < 1e-12);
    assert.equal(bars[0]?.rateUnset, false);
  });

  test("uses the recorded chat cost when token counts are missing", () => {
    const bars = sessionBars(
      [],
      [chat({ sessionId: "old", costTotal: 0.5 })],
      rateLookup(builtInRates),
    );
    assert.equal(bars.length, 1);
    assert.equal(bars[0]?.chat.tokens, 0);
    assert.equal(bars[0]?.chat.cost, 0.5);
    assert.equal(bars[0]?.chatEstimated, true);
    assert.equal(bars[0]?.chatRecordedCost, 0.5);
    assert.equal(bars[0]?.totalCost, 0.5);
  });
});

describe("model rates", () => {
  const dated: RateTable = {
    "deepseek-flash": [
      { effectiveFrom: "2026-01-01T00:00:00Z", input: 1_000_000, output: 0, cacheRead: 0 },
      { effectiveFrom: "2026-11-01T00:00:00Z", input: 3_000_000, output: 0, cacheRead: 0 },
    ],
  };

  test("picks the rate in effect when the call was recorded", () => {
    assert.equal(rateAt(dated, "deepseek-flash", "2026-10-31T23:59:59Z")?.input, 1_000_000);
    assert.equal(rateAt(dated, "deepseek-flash", "2026-11-01T00:00:00Z")?.input, 3_000_000);
    assert.equal(rateAt(dated, "deepseek-flash", "2025-06-01T00:00:00Z")?.input, 1_000_000);
    assert.equal(rateAt(dated, "gpt-6.1-sol", "2026-10-31T00:00:00Z"), undefined);
  });

  test("keeps an old session at its old price after a rate change", () => {
    const bars = sessionBars(
      [
        image({ sessionId: "old", recordedAt: "2026-10-20T00:00:00Z", inputTokens: 2, outputTokens: 0, cachedTokens: 0, totalTokens: 2 }),
        image({ sessionId: "new", recordedAt: "2026-11-02T00:00:00Z", inputTokens: 2, outputTokens: 0, cachedTokens: 0, totalTokens: 2 }),
      ],
      [],
      rateLookup(dated),
    );
    assert.deepEqual(bars.map((bar) => [bar.id, bar.totalCost]), [["session:old", 2], ["session:new", 6]]);
  });

  test("reads the file beside the agent directory", () => {
    assert.equal(
      modelRatesPath({ PI_CODING_AGENT_DIR: path.join("/home", "me", "image_describer", "image-describer") }),
      path.join("/home", "me", "image_describer", "model-rates.json"),
    );
  });

  test("sorts entries by effective date and ignores unsupported ids", () => {
    const parsed = parseModelRates(ratesFile({
      "deepseek-flash": [
        { effectiveFrom: "2026-11-01T00:00:00Z", input: 0.4, output: 1.5, cacheRead: 0.01, source: "pricing page" },
        { effectiveFrom: "2026-01-01T00:00:00Z", input: 0.3, output: 1.2, cacheRead: 0.006 },
      ],
      "made-up-model": [{ effectiveFrom: "2026-01-01T00:00:00Z", input: 1, output: 1, cacheRead: 1 }],
    }));
    assert.equal(parsed.updatedAt, "2026-10-25T10:00:00Z");
    assert.deepEqual(Object.keys(parsed.models), ["deepseek-flash"]);
    assert.deepEqual(parsed.models["deepseek-flash"]?.map((entry) => entry.effectiveFrom), [
      "2026-01-01T00:00:00Z",
      "2026-11-01T00:00:00Z",
    ]);
    assert.equal(parsed.models["deepseek-flash"]?.[1]?.source, "pricing page");
  });

  test("rejects a malformed file", () => {
    const entry = { effectiveFrom: "2026-01-01T00:00:00Z", input: 0.3, output: 1.2, cacheRead: 0.006 };
    assert.throws(() => parseModelRates("{"), /not valid JSON/);
    assert.throws(() => parseModelRates(ratesFile({ "deepseek-flash": [entry] }, { schemaVersion: 2 })), /schemaVersion must be 1/);
    assert.throws(() => parseModelRates(ratesFile({ "deepseek-flash": [entry] }, { currency: "EUR" })), /currency must be "USD"/);
    assert.throws(() => parseModelRates(ratesFile({ "deepseek-flash": [{ ...entry, input: -1 }] })), /input must be a number zero or higher/);
    assert.throws(() => parseModelRates(ratesFile({ "deepseek-flash": [{ ...entry, effectiveFrom: "soon" }] })), /effectiveFrom must be an ISO 8601 time/);
    assert.throws(() => parseModelRates(ratesFile({ "deepseek-flash": [entry, { ...entry }] })), /two entries/);
    assert.throws(() => parseModelRates(ratesFile({ "deepseek-flash": [] })), /non-empty array/);
  });

  test("the example file is valid and matches the built-in rates", async () => {
    const text = await readFile(path.join(import.meta.dirname, "..", "..", "model-rates.example.json"), "utf8");
    const models = parseModelRates(text).models;
    const prices = Object.fromEntries(Object.entries(models).map(([id, entries]) => [
      id,
      entries.map(({ source: _source, ...rest }) => rest),
    ]));
    assert.deepEqual(prices, builtInRates);
  });
});

describe("dashboard API", () => {
  test("serves the rates file, picks up a replaced file, and falls back to built-in rates", async () => {
    const dir = await tempDir();
    const agent = path.join(dir, "agent");
    const file = path.join(dir, "model-rates.json");
    const started = startDashboard({ root: dir, host: "127.0.0.1", port: 0, agentDir: agent });
    const getRates = async () => await (await fetch(`http://127.0.0.1:${boundPort(started.server)}/api/rates`)).json() as RatesSnapshot;
    try {
      await once(started.server, "listening");
      assert.deepEqual(await getRates(), { source: "built-in", updatedAt: null, models: builtInRates });

      const first = { effectiveFrom: "2026-01-01T00:00:00Z", input: 0.3, output: 1.2, cacheRead: 0.006 };
      await writeFile(file, ratesFile({ "deepseek-flash": [first] }));
      const fromFile = await getRates();
      assert.equal(fromFile.source, "file");
      assert.equal(fromFile.updatedAt, "2026-10-25T10:00:00Z");
      assert.deepEqual(fromFile.models["deepseek-flash"], [first]);
      assert.deepEqual(fromFile.models["gpt-6.1-sol"], builtInRates["gpt-6.1-sol"]);

      const second = { effectiveFrom: "2026-11-01T00:00:00Z", input: 0.4, output: 1.5, cacheRead: 0.01 };
      await writeFile(file, ratesFile({ "deepseek-flash": [first, second] }));
      assert.deepEqual((await getRates()).models["deepseek-flash"], [first, second]);

      await writeFile(file, "{ not json");
      const broken = await getRates();
      assert.equal(broken.source, "built-in");
      assert.deepEqual(broken.models, builtInRates);
      assert.match(broken.error ?? "", /model-rates\.json is not valid JSON/);
    } finally {
      await started.close();
      await removeDir(dir);
    }
  });

  test("serves empty charts from a new directory and keeps chat cost after the session file is gone", async () => {
    const dir = await tempDir();
    const started = startDashboard({ root: dir, host: "127.0.0.1", port: 0 });
    try {
      await once(started.server, "listening");
      const port = boundPort(started.server);
      assert.deepEqual(await getJson(port, "/api/images"), { points: [] });
      assert.deepEqual(await getJson(port, "/api/chat"), { points: [] });
      assert.equal(existsSync(path.join(dir, "logs", "metrics.sqlite")), true);

      const sessionFile = path.join(dir, "sessions", "room", "chat.jsonl");
      await mkdir(path.dirname(sessionFile), { recursive: true });
      await writeFile(sessionFile, `${sessionHeader("sess-api")}\n${assistantLine(0.4)}\n`);
      const copied = await getJson(port, "/api/chat");
      assert.equal(copied.points.length, 1);
      assert.equal(copied.points[0]?.costTotal, 0.4);
      assert.equal(copied.points[0]?.sessionId, "sess-api");
      await unlink(sessionFile);
      const kept = await getJson(port, "/api/chat");
      assert.equal(kept.points.length, 1);
      assert.equal(kept.points[0]?.costTotal, 0.4);
    } finally {
      await started.close();
      await removeDir(dir);
    }
  });

  test("reads and writes the default mode", async () => {
    const dir = await tempDir();
    const agent = path.join(dir, "agent");
    const started = startDashboard({ root: dir, host: "127.0.0.1", port: 0, agentDir: agent });
    try {
      await once(started.server, "listening");
      const port = boundPort(started.server);

      const preflight = await fetch(`http://127.0.0.1:${port}/api/default-mode`, { method: "OPTIONS" });
      assert.equal(preflight.status, 204);
      assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /\bPUT\b/);

      assert.deepEqual(await getMode(port), modeSwitches("general"));
      assert.equal(existsSync(path.join(agent, "default-mode.json")), false);

      const saved = await putMode(port, "work");
      assert.equal(saved.status, 200);
      assert.deepEqual(saved.switches, modeSwitches("work"));
      const written = JSON.parse(await readFile(path.join(agent, "default-mode.json"), "utf8")) as Record<string, boolean>;
      assert.deepEqual(written, modeSwitches("work"));

      const rejected = await putMode(port, "nope");
      assert.equal(rejected.status, 400);
      assert.match(rejected.error, /Unknown mode "nope"/);
      const unchanged = JSON.parse(await readFile(path.join(agent, "default-mode.json"), "utf8")) as Record<string, boolean>;
      assert.deepEqual(unchanged, modeSwitches("work"));
    } finally {
      await started.close();
      await removeDir(dir);
    }
  });

  test("reads and writes the detailed effort", async () => {
    const dir = await tempDir();
    const agent = path.join(dir, "agent");
    const started = startDashboard({ root: dir, host: "127.0.0.1", port: 0, agentDir: agent });
    const file = path.join(agent, "detailed-effort.json");
    try {
      await once(started.server, "listening");
      const port = boundPort(started.server);

      const initial = await fetch(`http://127.0.0.1:${port}/api/detailed-effort`);
      assert.equal(initial.status, 200);
      assert.deepEqual(await initial.json(), { effort: "medium" });
      assert.equal(existsSync(file), false);

      const saved = await fetch(`http://127.0.0.1:${port}/api/detailed-effort`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ effort: "high" }),
      });
      assert.equal(saved.status, 200);
      assert.deepEqual(await saved.json(), { effort: "high" });
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { effort: "high" });

      const rejected = await fetch(`http://127.0.0.1:${port}/api/detailed-effort`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ effort: "turbo" }),
      });
      assert.equal(rejected.status, 400);
      const body = await rejected.json() as { error?: string };
      assert.match(body.error ?? "", /Unknown effort "turbo"/);
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { effort: "high" });
    } finally {
      await started.close();
      await removeDir(dir);
    }
  });

  test("reads and writes the count effort", async () => {
    const dir = await tempDir();
    const agent = path.join(dir, "agent");
    const started = startDashboard({ root: dir, host: "127.0.0.1", port: 0, agentDir: agent });
    const file = path.join(agent, "count-effort.json");
    try {
      await once(started.server, "listening");
      const port = boundPort(started.server);

      const initial = await fetch(`http://127.0.0.1:${port}/api/count-effort`);
      assert.equal(initial.status, 200);
      assert.deepEqual(await initial.json(), { effort: "medium" });
      assert.equal(existsSync(file), false);

      const saved = await fetch(`http://127.0.0.1:${port}/api/count-effort`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ effort: "high" }),
      });
      assert.equal(saved.status, 200);
      assert.deepEqual(await saved.json(), { effort: "high" });
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { effort: "high" });

      const rejected = await fetch(`http://127.0.0.1:${port}/api/count-effort`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ effort: "turbo" }),
      });
      assert.equal(rejected.status, 400);
      const body = await rejected.json() as { error?: string };
      assert.match(body.error ?? "", /Unknown effort "turbo"/);
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { effort: "high" });
    } finally {
      await started.close();
      await removeDir(dir);
    }
  });

  test("reads and writes the preset effort", async () => {
    const dir = await tempDir();
    const agent = path.join(dir, "agent");
    const started = startDashboard({ root: dir, host: "127.0.0.1", port: 0, agentDir: agent });
    const file = path.join(agent, "preset-effort.json");
    try {
      await once(started.server, "listening");
      const port = boundPort(started.server);

      const initial = await fetch(`http://127.0.0.1:${port}/api/preset-effort`);
      assert.equal(initial.status, 200);
      assert.deepEqual(await initial.json(), { effort: "none" });
      assert.equal(existsSync(file), false);

      const saved = await fetch(`http://127.0.0.1:${port}/api/preset-effort`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ effort: "high" }),
      });
      assert.equal(saved.status, 200);
      assert.deepEqual(await saved.json(), { effort: "high" });
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { effort: "high" });

      const rejected = await fetch(`http://127.0.0.1:${port}/api/preset-effort`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ effort: "turbo" }),
      });
      assert.equal(rejected.status, 400);
      const body = await rejected.json() as { error?: string };
      assert.match(body.error ?? "", /Unknown effort "turbo"/);
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { effort: "high" });
    } finally {
      await started.close();
      await removeDir(dir);
    }
  });

  test("reads and writes the default provider", async () => {
    const dir = await tempDir();
    const agent = path.join(dir, "agent");
    const started = startDashboard({ root: dir, host: "127.0.0.1", port: 0, agentDir: agent });
    const file = path.join(agent, "default-provider.json");
    try {
      await once(started.server, "listening");
      const port = boundPort(started.server);

      const initial = await fetch(`http://127.0.0.1:${port}/api/default-provider`);
      assert.equal(initial.status, 200);
      assert.deepEqual(await initial.json(), { provider: "deepseek", model: "deepseek-flash" });
      assert.equal(existsSync(file), false);

      const byProvider = await fetch(`http://127.0.0.1:${port}/api/default-provider`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai" }),
      });
      assert.equal(byProvider.status, 200);
      assert.deepEqual(await byProvider.json(), { provider: "openai", model: "gpt-6.1-sol" });
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { provider: "openai", model: "gpt-6.1-sol" });

      const byModel = await fetch(`http://127.0.0.1:${port}/api/default-provider`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gemini-3.8-flash" }),
      });
      assert.equal(byModel.status, 200);
      assert.deepEqual(await byModel.json(), { provider: "gemini", model: "gemini-3.8-flash" });

      const paired = await fetch(`http://127.0.0.1:${port}/api/default-provider`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", model: "gpt-6.1-sol" }),
      });
      assert.equal(paired.status, 200);
      assert.deepEqual(await paired.json(), { provider: "openai", model: "gpt-6.1-sol" });

      const mismatch = await fetch(`http://127.0.0.1:${port}/api/default-provider`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", model: "gemini-3.8-flash" }),
      });
      assert.equal(mismatch.status, 400);
      const mismatchBody = await mismatch.json() as { error?: string };
      assert.match(mismatchBody.error ?? "", /belongs to gemini, not openai/);

      const unknown = await fetch(`http://127.0.0.1:${port}/api/default-provider`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "google" }),
      });
      assert.equal(unknown.status, 400);
      const empty = await fetch(`http://127.0.0.1:${port}/api/default-provider`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(empty.status, 400);
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { provider: "openai", model: "gpt-6.1-sol" });
    } finally {
      await started.close();
      await removeDir(dir);
    }
  });

  test("reads and writes the default language", async () => {
    const dir = await tempDir();
    const agent = path.join(dir, "agent");
    const started = startDashboard({ root: dir, host: "127.0.0.1", port: 0, agentDir: agent });
    const file = path.join(agent, "default-language.json");
    try {
      await once(started.server, "listening");
      const port = boundPort(started.server);

      const initial = await fetch(`http://127.0.0.1:${port}/api/default-language`);
      assert.equal(initial.status, 200);
      assert.deepEqual(await initial.json(), { language: "English" });
      assert.equal(existsSync(file), false);

      const saved = await fetch(`http://127.0.0.1:${port}/api/default-language`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "  Portuguese  " }),
      });
      assert.equal(saved.status, 200);
      assert.deepEqual(await saved.json(), { language: "Portuguese" });
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { language: "Portuguese" });

      const again = await fetch(`http://127.0.0.1:${port}/api/default-language`);
      assert.deepEqual(await again.json(), { language: "Portuguese" });

      const empty = await fetch(`http://127.0.0.1:${port}/api/default-language`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "   " }),
      });
      assert.equal(empty.status, 400);
      const emptyBody = await empty.json() as { error?: string };
      assert.match(emptyBody.error ?? "", /Language must be a single line of at most 80 characters/);

      const newline = await fetch(`http://127.0.0.1:${port}/api/default-language`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "Portuguese\nEnglish" }),
      });
      assert.equal(newline.status, 400);
      const long = await fetch(`http://127.0.0.1:${port}/api/default-language`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "P".repeat(81) }),
      });
      assert.equal(long.status, 400);
      const missing = await fetch(`http://127.0.0.1:${port}/api/default-language`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(missing.status, 400);
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { language: "Portuguese" });
    } finally {
      await started.close();
      await removeDir(dir);
    }
  });

  test("reads and writes the images directory", async () => {
    const dir = await tempDir();
    const agent = path.join(dir, "agent");
    const inbox = path.join(dir, "inbox");
    await mkdir(agent, { recursive: true });
    await mkdir(inbox, { recursive: true });
    const started = startDashboard({ root: dir, host: "127.0.0.1", port: 0, agentDir: agent });
    const file = path.join(agent, "images-dir.json");
    try {
      await once(started.server, "listening");
      const port = boundPort(started.server);

      const initial = await fetch(`http://127.0.0.1:${port}/api/images-dir`);
      assert.equal(initial.status, 200);
      assert.deepEqual(await initial.json(), { dir: null });
      assert.equal(existsSync(file), false);

      const saved = await fetch(`http://127.0.0.1:${port}/api/images-dir`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dir: inbox }),
      });
      assert.equal(saved.status, 200);
      assert.deepEqual(await saved.json(), { dir: inbox });
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { dir: inbox });

      const relative = await fetch(`http://127.0.0.1:${port}/api/images-dir`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dir: "../inbox" }),
      });
      assert.equal(relative.status, 200);
      assert.deepEqual(await relative.json(), { dir: inbox });

      const again = await fetch(`http://127.0.0.1:${port}/api/images-dir`);
      assert.deepEqual(await again.json(), { dir: inbox });

      const empty = await fetch(`http://127.0.0.1:${port}/api/images-dir`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dir: "   " }),
      });
      assert.equal(empty.status, 400);
      const missingPath = await fetch(`http://127.0.0.1:${port}/api/images-dir`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dir: path.join(dir, "no-such-folder") }),
      });
      assert.equal(missingPath.status, 400);
      const missing = await fetch(`http://127.0.0.1:${port}/api/images-dir`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(missing.status, 400);
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { dir: inbox });
    } finally {
      await started.close();
      await removeDir(dir);
    }
  });

  test("saves, rejects, and resets a mode prompt", async () => {
    const dir = await tempDir();
    const agent = path.join(dir, "agent");
    const started = startDashboard({ root: dir, host: "127.0.0.1", port: 0, agentDir: agent });
    try {
      await once(started.server, "listening");
      const port = boundPort(started.server);
      const file = path.join(agent, "prompts.json");

      const initial = await prompts(port, "GET", "");
      assert.equal(initial.status, 200);
      assert.equal(initial.body.shape, OUTPUT_SHAPE);
      assert.equal(initial.body.rules, PROMPT_RULES);
      assert.deepEqual(initial.body.prompts?.map((entry) => entry.mode), [...PROMPT_MODES]);
      assert.equal(initial.body.prompts?.find((entry) => entry.mode === "venue")?.builtIn, BUILT_IN_PROMPTS.venue);
      assert.ok(initial.body.prompts?.every((entry) => entry.saved === null));
      assert.equal(existsSync(file), false);

      const saved = await prompts(port, "PUT", "/work", { prompt: "  List every deadline in {language}.  " });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.prompts?.find((entry) => entry.mode === "work")?.saved, "List every deadline in {language}.");
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { work: "List every deadline in {language}." });

      const unknown = await prompts(port, "PUT", "/invoice", { prompt: "x" });
      assert.equal(unknown.status, 400);
      assert.match(unknown.body.error ?? "", /Unknown mode "invoice"/);
      const empty = await prompts(port, "PUT", "/work", { prompt: "   " });
      assert.equal(empty.status, 400);
      const missing = await prompts(port, "PUT", "/work", {});
      assert.equal(missing.status, 400);
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { work: "List every deadline in {language}." });

      const reset = await prompts(port, "DELETE", "/work");
      assert.equal(reset.status, 200);
      assert.equal(reset.body.prompts?.find((entry) => entry.mode === "work")?.saved, null);
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {});
    } finally {
      await started.close();
      await removeDir(dir);
    }
  });

  test("allows only the configured origins to change settings", async () => {
    const dir = await tempDir();
    const agent = path.join(dir, "agent");
    const allowed = "http://127.0.0.1:5173";
    const started = startDashboard({ root: dir, host: "127.0.0.1", port: 0, agentDir: agent, origins: [allowed] });
    try {
      await once(started.server, "listening");
      const port = boundPort(started.server);
      const url = `http://127.0.0.1:${port}/api/prompts/general`;
      const put = (origin: string) => fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ prompt: "Changed in {language}." }),
      });

      const blocked = await put("https://evil.example");
      assert.equal(blocked.status, 403);
      assert.equal(blocked.headers.get("access-control-allow-origin"), null);
      assert.equal(existsSync(path.join(agent, "prompts.json")), false);
      const preflight = await fetch(url, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
      assert.equal(preflight.status, 403);

      const ok = await put(allowed);
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get("access-control-allow-origin"), allowed);

      const read = await fetch(`http://127.0.0.1:${port}/api/prompts`, { headers: { origin: "https://evil.example" } });
      assert.equal(read.status, 200);
      assert.equal(read.headers.get("access-control-allow-origin"), null);
    } finally {
      await started.close();
      await removeDir(dir);
    }
  });
});

async function prompts(
  port: number,
  method: "GET" | "PUT" | "DELETE",
  suffix: string,
  payload?: unknown,
): Promise<{
  status: number;
  body: { shape?: string; rules?: string; error?: string; prompts?: Array<{ mode: string; builtIn: string; saved: string | null }> };
}> {
  const response = await fetch(`http://127.0.0.1:${port}/api/prompts${suffix}`, {
    method,
    ...(payload !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : {}),
  });
  return { status: response.status, body: await response.json() as Awaited<ReturnType<typeof prompts>>["body"] };
}

function flatRates(rates: Record<string, ModelRate>): RateLookup {
  return (model) => rates[model];
}

function ratesFile(models: Record<string, unknown>, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    currency: "USD",
    unit: "per_million_tokens",
    updatedAt: "2026-10-25T10:00:00Z",
    models,
    ...overrides,
  });
}

function imageRow() {
  return image({ runId: "run-1", filename: "a.jpg", totalTokens: 100 });
}

function image(overrides: Partial<ImagePoint> = {}): ImagePoint {
  return {
    runId: "run-1",
    recordedAt: "2026-10-23T00:00:00.000Z",
    filename: "a.jpg",
    mode: "general",
    effort: "none",
    language: "English",
    model: "deepseek-flash",
    provider: "deepseek",
    status: "succeeded",
    apiDurationSeconds: 1,
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 1,
    reasoningTokens: null,
    cachedTokens: null,
    ...overrides,
  };
}

function chat(overrides: Partial<ChatPoint> = {}): ChatPoint {
  return {
    id: "msg-1",
    recordedAt: "2026-10-23T00:00:01.000Z",
    model: "deepseek-flash",
    provider: "deepseek",
    costTotal: 0,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    ...overrides,
  };
}

function sessionHeader(id: string): string {
  return JSON.stringify({ type: "session", id, timestamp: "2026-10-22T18:27:08.022Z" });
}

function assistantLine(total: number, usage?: {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
} | null): string {
  const counts = usage === undefined
    ? { input: 367, output: 40 }
    : usage === null
      ? {}
      : {
          input: usage.input,
          output: usage.output,
          ...(usage.cacheRead != null ? { cacheRead: usage.cacheRead } : {}),
          ...(usage.cacheWrite != null ? { cacheWrite: usage.cacheWrite } : {}),
          ...(usage.reasoning != null ? { reasoning: usage.reasoning } : {}),
        };
  return JSON.stringify({
    type: "message",
    id: "msg-1",
    timestamp: "2026-10-22T18:27:08.022Z",
    message: {
      role: "assistant",
      provider: "deepseek",
      model: "deepseek-flash",
      usage: { ...counts, cost: { total } },
    },
  });
}

async function removeDatabase(file: string): Promise<void> {
  for (const suffix of ["", "-wal", "-shm"]) {
    await unlink(`${file}${suffix}`).catch(() => undefined);
  }
}

function boundPort(server: { address: () => string | { port: number } | null }): number {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Dashboard did not bind a port.");
  return address.port;
}

async function getMode(port: number): Promise<Record<string, boolean>> {
  const response = await fetch(`http://127.0.0.1:${port}/api/default-mode`);
  assert.equal(response.status, 200);
  const body = await response.json() as { switches: Record<string, boolean> };
  return body.switches;
}

async function putMode(
  port: number,
  mode: string,
): Promise<{ status: number; switches?: Record<string, boolean>; error: string }> {
  const response = await fetch(`http://127.0.0.1:${port}/api/default-mode`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  const body = await response.json() as { switches?: Record<string, boolean>; error?: string };
  return { status: response.status, switches: body.switches, error: body.error ?? "" };
}

async function getJson(port: number, pathname: string): Promise<{ points: Array<{ costTotal?: number; sessionId?: string }> }> {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  assert.equal(response.status, 200);
  return await response.json() as { points: Array<{ costTotal?: number; sessionId?: string }> };
}
