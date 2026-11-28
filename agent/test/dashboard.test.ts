import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { startDashboard, type Dashboard } from "../dashboard/server.ts";

const ORIGIN = "http://127.0.0.1:5173";
const SESSION_ID = "01a17c82-7f3a-76e9-b3d7-b845626e2832";

let repo: string;
let root: string;
let dashboard: Dashboard;
let base: string;

const SESSION = [
  JSON.stringify({ type: "session", id: SESSION_ID, timestamp: "2026-10-27T08:00:00.000Z" }),
  JSON.stringify({
    type: "message",
    id: "u1",
    timestamp: "2026-10-27T08:00:01.000Z",
    message: { role: "user", content: "What is 2+2?", timestamp: 1 },
  }),
  JSON.stringify({
    type: "message",
    id: "a1",
    timestamp: "2026-10-27T08:00:02.000Z",
    message: {
      role: "assistant",
      provider: "deepseek",
      model: "deepseek-flash",
      stopReason: "stop",
      durationMs: 1200,
      usage: {
        input: 1000,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        totalTokens: 1010,
        cost: { total: 0.000312 },
      },
    },
  }),
].join("\n");

const CATALOG = {
  deepseek: {
    models: [{ id: "deepseek-flash", name: "DeepSeek Flash", contextWindow: 1000000, cost: { input: 0.3, output: 1.2, cacheRead: 0.006 } }],
  },
  openai: {
    models: [{ id: "gpt-5.4", name: "GPT-5.4", contextWindow: 400000, cost: { input: 2.5, output: 15, cacheRead: 0.25 } }],
  },
};

before(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "cos-orchestrator-agent-dash-"));
  root = path.join(repo, "cos-orchestrator-agent");
  await mkdir(path.join(root, "sessions", "--tmp--"), { recursive: true });
  await mkdir(path.join(root, "logs"), { recursive: true });
  await writeFile(path.join(root, "sessions", "--tmp--", `2026-10-27T08-00-00-000Z_${SESSION_ID}.jsonl`), `${SESSION}\n`, "utf8");
  await writeFile(path.join(root, "models-store.json"), JSON.stringify(CATALOG), "utf8");
  await writeFile(
    path.join(root, "model-rates.json"),
    JSON.stringify({
      schemaVersion: 1,
      currency: "USD",
      unit: "per_million_tokens",
      updatedAt: "2026-10-27T08:00:00Z",
      models: { "deepseek-flash": [{ effectiveFrom: "2026-01-01T00:00:00Z", input: 0.3, output: 1.2, cacheRead: 0.006 }] },
    }),
    "utf8",
  );

  dashboard = startDashboard({ root, port: 0, origins: [ORIGIN] });
  await new Promise<void>((resolve) => {
    if (dashboard.server.listening) resolve();
    else dashboard.server.once("listening", resolve);
  });
  base = `http://127.0.0.1:${(dashboard.server.address() as AddressInfo).port}`;
});

after(async () => {
  await dashboard.close();
  await rm(repo, { recursive: true, force: true });
});

describe("dashboard", () => {
  it("serves the page and its assets", async () => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /cos<span>·<\/span>orchestrator<span>·<\/span>agent/);
    const script = await fetch(`${base}/app.js`);
    assert.equal(script.status, 200);
    assert.match(await script.text(), /api\/data/);
  });

  it("reports calls ingested from sessions, with both cost figures", async () => {
    const response = await fetch(`${base}/api/data`);
    assert.equal(response.status, 200);
    const data = (await response.json()) as {
      calls: Array<{ total: number; costEstimated: number; costPi: number; origin: string }>;
      totals: Array<{ model: string; tokens: { total: number } }>;
      rates: { source: string; version: string };
      runs: Array<{ unrated: number }>;
    };
    assert.equal(data.calls.length, 1);
    assert.equal(data.calls[0].total, 1010);
    assert.equal(data.calls[0].origin, "chat");
    assert.equal(Number(data.calls[0].costEstimated.toFixed(8)), 0.000312);
    assert.equal(data.calls[0].costPi, 0.000312);
    assert.equal(data.totals[0].model, "deepseek-flash");
    assert.equal(data.rates.source, "file");
    assert.equal(data.runs[0].unrated, 0);
  });

  it("offers only catalog models in settings", async () => {
    const response = await fetch(`${base}/api/settings`);
    const settings = (await response.json()) as { models: Array<{ provider: string; id: string }>; thinkingLevels: string[] };
    assert.deepEqual(
      settings.models.map((model) => `${model.provider}/${model.id}`),
      ["deepseek/deepseek-flash", "openai/gpt-5.4"],
    );
    assert.ok(settings.thinkingLevels.includes("low"));
  });

  it("saves the next-launch model", async () => {
    const response = await fetch(`${base}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ provider: "openai", model: "gpt-5.4", thinking: "high" }),
    });
    assert.equal(response.status, 200);
    const saved = JSON.parse(await readFile(path.join(root, "default-model.json"), "utf8")) as Record<string, unknown>;
    assert.equal(saved.provider, "openai");
    assert.equal(saved.model, "gpt-5.4");
    assert.equal(saved.thinking, "high");
  });

  it("refuses a model that is not in the catalog", async () => {
    const response = await fetch(`${base}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ provider: "openai", model: "not-a-model", thinking: "low" }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /not in the provider catalog/);
  });

  it("refuses an unknown effort level", async () => {
    const response = await fetch(`${base}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ provider: "openai", model: "gpt-5.4", thinking: "turbo" }),
    });
    assert.equal(response.status, 400);
  });

  it("refuses a foreign origin", async () => {
    const response = await fetch(`${base}/api/data`, { headers: { origin: "http://evil.example" } });
    assert.equal(response.status, 403);
  });

  it("does not serve files outside the public folder", async () => {
    const response = await fetch(`${base}/..%2Fserver.ts`);
    assert.equal(response.status, 404);
  });

  it("answers an unknown route with a JSON error", async () => {
    const response = await fetch(`${base}/api/nope`);
    assert.equal(response.status, 404);
    assert.match(((await response.json()) as { error: string }).error, /No route/);
  });

  it("opens an event stream and announces itself", async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, { signal: controller.signal });
    assert.equal(response.status, 200);
    const reader = response.body?.getReader();
    assert.ok(reader);
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    assert.match(text, /event: ready/);
    controller.abort();
  });

  it("refuses a body that is not JSON", async () => {
    const response = await fetch(`${base}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: "{ nope",
    });
    assert.equal(response.status, 400);
    assert.match(((await response.json()) as { error: string }).error, /not valid JSON/);
  });
});

describe("dashboard isolation", () => {
  it("falls back to settings.json when default-model.json is absent", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cos-dash-settings-"));
    const home = path.join(dir, "cos-orchestrator-agent");
    await mkdir(path.join(home, "logs"), { recursive: true });
    await writeFile(path.join(home, "models-store.json"), JSON.stringify(CATALOG), "utf8");
    await writeFile(
      path.join(home, "settings.json"),
      JSON.stringify({ defaultProvider: "deepseek", defaultModel: "deepseek-flash", defaultThinkingLevel: "max" }),
      "utf8",
    );
    const extra = startDashboard({ root: home, port: 0, origins: [ORIGIN] });
    try {
      await new Promise<void>((resolve) => {
        if (extra.server.listening) resolve();
        else extra.server.once("listening", resolve);
      });
      const url = `http://127.0.0.1:${(extra.server.address() as AddressInfo).port}`;
      const settings = (await (await fetch(`${url}/api/settings`)).json()) as {
        current: { provider: string; model: string; thinking: string };
        source: string;
      };
      assert.equal(settings.source, "settings");
      assert.equal(settings.current.provider, "deepseek");
      assert.equal(settings.current.model, "deepseek-flash");
      assert.equal(settings.current.thinking, "max");
    } finally {
      await extra.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a malformed rate card after falling back to the catalog", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cos-dash-rates-"));
    const home = path.join(dir, "cos-orchestrator-agent");
    await mkdir(path.join(home, "logs"), { recursive: true });
    await writeFile(path.join(home, "models-store.json"), JSON.stringify(CATALOG), "utf8");
    await writeFile(path.join(home, "model-rates.json"), "{ nope", "utf8");
    const extra = startDashboard({ root: home, port: 0, origins: [ORIGIN] });
    try {
      await new Promise<void>((resolve) => {
        if (extra.server.listening) resolve();
        else extra.server.once("listening", resolve);
      });
      const url = `http://127.0.0.1:${(extra.server.address() as AddressInfo).port}`;
      const data = (await (await fetch(`${url}/api/data`)).json()) as { rates: { source: string; error?: string } };
      assert.equal(data.rates.source, "catalog");
      assert.ok(data.rates.error);
    } finally {
      await extra.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("allows the bound origin when no allow-list is passed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cos-dash-cors-"));
    const home = path.join(dir, "cos-orchestrator-agent");
    await mkdir(path.join(home, "logs"), { recursive: true });
    await writeFile(path.join(home, "models-store.json"), JSON.stringify(CATALOG), "utf8");
    const extra = startDashboard({ root: home, port: 0 });
    try {
      await new Promise<void>((resolve) => {
        if (extra.server.listening) resolve();
        else extra.server.once("listening", resolve);
      });
      const port = (extra.server.address() as AddressInfo).port;
      const url = `http://127.0.0.1:${port}`;
      const response = await fetch(`${url}/api/data`, { headers: { origin: url } });
      assert.equal(response.status, 200);
    } finally {
      await extra.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts a same-origin request when bound to a wildcard address", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cos-dash-wild-"));
    const home = path.join(dir, "cos-orchestrator-agent");
    await mkdir(path.join(home, "logs"), { recursive: true });
    await writeFile(path.join(home, "models-store.json"), JSON.stringify(CATALOG), "utf8");
    const extra = startDashboard({ root: home, host: "0.0.0.0", port: 0 });
    try {
      await new Promise<void>((resolve) => {
        if (extra.server.listening) resolve();
        else extra.server.once("listening", resolve);
      });
      const url = `http://127.0.0.1:${(extra.server.address() as AddressInfo).port}`;
      assert.equal((await fetch(`${url}/api/data`, { headers: { origin: url } })).status, 200);
      assert.equal((await fetch(`${url}/api/data`, { headers: { origin: "http://evil.example" } })).status, 403);
    } finally {
      await extra.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads an empty DASHBOARD_ORIGIN as unset", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cos-dash-empty-"));
    const home = path.join(dir, "cos-orchestrator-agent");
    await mkdir(path.join(home, "logs"), { recursive: true });
    await writeFile(path.join(home, "models-store.json"), JSON.stringify(CATALOG), "utf8");
    const previous = process.env.DASHBOARD_ORIGIN;
    process.env.DASHBOARD_ORIGIN = "";
    const extra = startDashboard({ root: home, port: 0 });
    try {
      await new Promise<void>((resolve) => {
        if (extra.server.listening) resolve();
        else extra.server.once("listening", resolve);
      });
      const url = `http://127.0.0.1:${(extra.server.address() as AddressInfo).port}`;
      assert.equal((await fetch(`${url}/api/data`, { headers: { origin: url } })).status, 200);
    } finally {
      if (previous === undefined) delete process.env.DASHBOARD_ORIGIN;
      else process.env.DASHBOARD_ORIGIN = previous;
      await extra.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("broadcasts an update when a new session line is ingested", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cos-dash-sse-"));
    const home = path.join(dir, "cos-orchestrator-agent");
    const sessionDir = path.join(home, "sessions", "--tmp--");
    await mkdir(sessionDir, { recursive: true });
    await mkdir(path.join(home, "logs"), { recursive: true });
    const sessionFile = path.join(sessionDir, `2026-10-27T08-00-00-000Z_${SESSION_ID}.jsonl`);
    await writeFile(sessionFile, `${SESSION}\n`, "utf8");
    await writeFile(path.join(home, "models-store.json"), JSON.stringify(CATALOG), "utf8");
    await writeFile(
      path.join(home, "model-rates.json"),
      JSON.stringify({
        schemaVersion: 1,
        currency: "USD",
        unit: "per_million_tokens",
        updatedAt: "2026-10-27T08:00:00Z",
        models: { "deepseek-flash": [{ effectiveFrom: "2026-01-01T00:00:00Z", input: 0.3, output: 1.2, cacheRead: 0.006 }] },
      }),
      "utf8",
    );
    const extra = startDashboard({ root: home, port: 0, origins: [ORIGIN], pollMs: 50 });
    try {
      await new Promise<void>((resolve) => {
        if (extra.server.listening) resolve();
        else extra.server.once("listening", resolve);
      });
      const url = `http://127.0.0.1:${(extra.server.address() as AddressInfo).port}`;
      await fetch(`${url}/api/data`);
      const controller = new AbortController();
      const response = await fetch(`${url}/api/events`, { signal: controller.signal });
      const reader = response.body?.getReader();
      assert.ok(reader);
      const first = await reader.read();
      assert.match(new TextDecoder().decode(first.value), /event: ready/);
      const extraTurn = [
        JSON.stringify({
          type: "message",
          id: "u2",
          timestamp: "2026-10-27T08:01:00.000Z",
          message: { role: "user", content: "Again?", timestamp: 2 },
        }),
        JSON.stringify({
          type: "message",
          id: "a2",
          timestamp: "2026-10-27T08:01:01.000Z",
          message: {
            role: "assistant",
            provider: "deepseek",
            model: "deepseek-flash",
            stopReason: "stop",
            durationMs: 800,
            usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 15, cost: { total: 0.00001 } },
          },
        }),
      ].join("\n");
      await writeFile(sessionFile, `${SESSION}\n${extraTurn}\n`, "utf8");
      const deadline = Date.now() + 2000;
      let sawUpdate = false;
      while (Date.now() < deadline) {
        const next = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value: undefined }>((resolve) => setTimeout(() => resolve({ done: true, value: undefined }), 100)),
        ]);
        const text = new TextDecoder().decode(next.value);
        if (text.includes("event: update") && text.includes('"reason":"data"')) {
          sawUpdate = true;
          break;
        }
      }
      controller.abort();
      assert.equal(sawUpdate, true);
    } finally {
      await extra.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
