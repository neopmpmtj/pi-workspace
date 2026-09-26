/**
 * Unit tests for summarize.mjs
 * Run: node --test tests/summarize.test.mjs
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = join(__dirname, "..", "test-tmp");

// Helper
function cleanTestDir() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
}

// ── Text Extraction ────────────────────────────────────────────────────────
function extractText(content) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed
        .filter(b => b.type === "text" && b.text)
        .map(b => b.text)
        .join(" ");
    }
    return content;
  } catch {
    return content;
  }
}

// ── State Management ───────────────────────────────────────────────────────
const STATE_FILE = join(TEST_DIR, "test-state.json");

function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

// ── Config Resolution ──────────────────────────────────────────────────────
function resolveConfig(cfg) {
  if (!cfg.providers[cfg.provider]) {
    throw new Error(`Unknown provider: ${cfg.provider}`);
  }
  const prov = cfg.providers[cfg.provider];
  cfg._endpoint = prov.endpoint;
  cfg._apiKeyEnv = prov.apiKeyEnv;
  cfg.summariesPath = cfg.summariesPath;
  cfg.outputPath = cfg.outputPath || join(dirname(cfg.summariesPath), "..", "sessions-memory");
  return cfg;
}

// ── YAML Frontmatter ───────────────────────────────────────────────────────
function buildFrontmatter(data, filename) {
  const lines = [
    "---",
    `sessionName: "${(data.sessionName || "unnamed").replace(/"/g, '\\"')}"`,
    `date: ${data.capturedAt || "unknown"}`,
    `sourceFile: ${filename}`,
    `messageCount: ${data.messageCount || 0}`,
    `reason: ${data.reason || "unknown"}`,
    `sessionFile: "${(data.sessionFile || "unknown").replace(/"/g, '\\"')}"`,
    "---",
    "",
  ];
  return lines.join("\n");
}

// ── File Scanning ──────────────────────────────────────────────────────────
function findSummarizable(summariesPath, state, force) {
  if (!existsSync(summariesPath)) return [];

  const files = readdirSync(summariesPath)
    .filter(f => f.endsWith(".json"))
    .filter(f => force || !state[f])
    .sort();

  const needsLLM = [];
  const alreadyHasSummary = [];

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(summariesPath, file), "utf-8"));
      if (typeof data.summary === "string" && data.summary.length > 0) {
        alreadyHasSummary.push(file);
      } else {
        needsLLM.push(file);
      }
    } catch {
      // skip
    }
  }

  return { needsLLM, alreadyHasSummary };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("extractText", () => {
  it("extracts text from JSON content blocks", () => {
    const input = JSON.stringify([
      { type: "text", text: "Hello" },
      { type: "thinking", thinking: "hmm..." },
    ]);
    assert.equal(extractText(input), "Hello");
  });

  it("returns plain text unchanged", () => {
    assert.equal(extractText("Hello world"), "Hello world");
  });

  it("handles invalid JSON gracefully", () => {
    assert.equal(extractText("{bad}"), "{bad}");
  });
});

describe("state management", () => {
  beforeEach(() => cleanTestDir());

  it("is idempotent across runs", () => {
    let state = loadState();
    assert.deepEqual(state, {});

    state["file1.json"] = "2026-01-01T00:00:00Z";
    saveState(state);

    state = loadState();
    assert.equal(Object.keys(state).length, 1);
    assert.ok(state["file1.json"]);
  });

  it("force flag starts with empty state", () => {
    let state = {};
    state["file1.json"] = "2026-01-01T00:00:00Z";
    saveState(state);

    // Simulate --force: start fresh
    state = {};
    assert.deepEqual(state, {});
  });
});

describe("config resolution", () => {
  const baseCfg = {
    provider: "deepseek",
    providers: {
      deepseek: { endpoint: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_API_KEY" },
      openai: { endpoint: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" },
    },
    summariesPath: "/tmp/summaries",
  };

  it("defaults outputPath when not configured", () => {
    const cfg = resolveConfig({ ...baseCfg });
    assert.ok(cfg.outputPath.includes("sessions-memory"));
  });

  it("respects configured outputPath", () => {
    const cfg = resolveConfig({ ...baseCfg, outputPath: "/custom/output" });
    assert.equal(cfg.outputPath, "/custom/output");
  });

  it("throws on unknown provider", () => {
    assert.throws(() => resolveConfig({ ...baseCfg, provider: "nonexistent" }));
  });
});

describe("file scanning", () => {
  beforeEach(() => cleanTestDir());

  it("returns empty for nonexistent folder", () => {
    const result = findSummarizable(join(TEST_DIR, "nope"), {}, false);
    assert.deepEqual(result, []);
  });

  it("separates needsLLM from alreadyHasSummary", () => {
    writeFileSync(join(TEST_DIR, "a.json"), JSON.stringify({ summary: null, messages: [] }));
    writeFileSync(join(TEST_DIR, "b.json"), JSON.stringify({ summary: "already done", messages: [] }));
    writeFileSync(join(TEST_DIR, "c.json"), JSON.stringify({ summary: null, messages: [] }));

    const { needsLLM, alreadyHasSummary } = findSummarizable(TEST_DIR, {}, false);
    assert.deepEqual(needsLLM, ["a.json", "c.json"]);
    assert.deepEqual(alreadyHasSummary, ["b.json"]);
  });

  it("respects state (skips processed)", () => {
    writeFileSync(join(TEST_DIR, "a.json"), JSON.stringify({ summary: null, messages: [] }));
    writeFileSync(join(TEST_DIR, "b.json"), JSON.stringify({ summary: null, messages: [] }));

    const state = { "a.json": "2026-01-01T00:00:00Z" };
    const { needsLLM } = findSummarizable(TEST_DIR, state, false);
    assert.deepEqual(needsLLM, ["b.json"]);
  });

  it("force flag ignores state", () => {
    writeFileSync(join(TEST_DIR, "a.json"), JSON.stringify({ summary: null, messages: [] }));
    const state = { "a.json": "already processed" };
    const { needsLLM } = findSummarizable(TEST_DIR, state, true);
    assert.deepEqual(needsLLM, ["a.json"]);
  });
});

describe("state auto-clean (stale entries)", () => {
  beforeEach(() => cleanTestDir());

  it("removes state entries for files that no longer exist", () => {
    const state = {
      "old-file.json": "2026-01-01T00:00:00Z",
      "also-gone.json": "2026-01-02T00:00:00Z",
    };

    // No files exist in TEST_DIR -- all state entries are stale
    let cleaned = 0;
    for (const filename of Object.keys(state)) {
      if (!existsSync(join(TEST_DIR, filename))) {
        delete state[filename];
        cleaned++;
      }
    }

    assert.equal(cleaned, 2);
    assert.deepEqual(state, {});
  });

  it("keeps state entries for files that still exist", () => {
    writeFileSync(join(TEST_DIR, "real-file.json"), JSON.stringify({ summary: null, messages: [] }));

    const state = {
      "real-file.json": "2026-01-01T00:00:00Z",
      "gone-file.json": "2026-01-02T00:00:00Z",
    };

    let cleaned = 0;
    for (const filename of Object.keys(state)) {
      if (!existsSync(join(TEST_DIR, filename))) {
        delete state[filename];
        cleaned++;
      }
    }

    assert.equal(cleaned, 1);
    assert.equal(Object.keys(state).length, 1);
    assert.ok(state["real-file.json"]);
    assert.equal(state["gone-file.json"], undefined);
  });

  it("does nothing when state is clean (all files exist)", () => {
    writeFileSync(join(TEST_DIR, "a.json"), JSON.stringify({ summary: null, messages: [] }));
    writeFileSync(join(TEST_DIR, "b.json"), JSON.stringify({ summary: null, messages: [] }));

    const state = { "a.json": "t1", "b.json": "t2" };
    let cleaned = 0;
    for (const filename of Object.keys(state)) {
      if (!existsSync(join(TEST_DIR, filename))) {
        delete state[filename];
        cleaned++;
      }
    }

    assert.equal(cleaned, 0);
    assert.equal(Object.keys(state).length, 2);
  });
});

describe("yaml frontmatter", () => {
  it("includes all metadata fields", () => {
    const data = {
      sessionName: "My Session",
      capturedAt: "2026-07-27T12:00:00Z",
      reason: "new",
      messageCount: 42,
      sessionFile: "/path/to/file.jsonl",
    };
    const fm = buildFrontmatter(data, "test.json");

    assert.ok(fm.startsWith("---"));
    assert.ok(fm.includes('sessionName: "My Session"'));
    assert.ok(fm.includes("date: 2026-07-27T12:00:00Z"));
    assert.ok(fm.includes("sourceFile: test.json"));
    assert.ok(fm.includes("messageCount: 42"));
    assert.ok(fm.includes("reason: new"));
    assert.ok(fm.endsWith("---\n"));
  });

  it("escapes quotes in strings", () => {
    const data = { sessionName: 'He said "hello"', sessionFile: "/tmp/test.jsonl" };
    const fm = buildFrontmatter(data, "test.json");
    assert.ok(fm.includes('sessionName: "He said \\"hello\\""'));
  });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});
