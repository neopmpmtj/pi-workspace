/**
 * summarize.mjs — Standalone session summarizer.
 *
 * Reads session-summaries/*.json files, calls the configured LLM,
 * and writes .summary.md files to the output folder.
 *
 * Usage:  node summarize.mjs [--dry-run] [--force]
 *         node summarize.mjs --config /path/to/config.json
 *
 * --dry-run   Show what would be processed, don't actually do it.
 * --force     Reprocess all files, ignoring the state tracker.
 *
 * State is stored in summarizer-state.json (tracks processed files).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Paths ──────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = join(__dirname, "summarizer-config.json");
const STATE_FILE = join(__dirname, "summarizer-state.json");
const LOG_FILE = join(__dirname, "summarizer.log");

// ── Logging ────────────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

// ── Config ─────────────────────────────────────────────────────────────────
function loadConfig(configPath) {
  if (!existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }
  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw);
}

function resolveConfig(cfg) {
  // Resolve absolute paths
  cfg.summariesPath = resolve(cfg.summariesPath);
  cfg.outputPath = resolve(cfg.outputPath || join(dirname(cfg.summariesPath), "..", "sessions-memory"));

  // Validate provider
  if (!cfg.providers[cfg.provider]) {
    throw new Error(`Unknown provider: ${cfg.provider}. Known: ${Object.keys(cfg.providers).join(", ")}`);
  }

  const prov = cfg.providers[cfg.provider];
  cfg._endpoint = prov.endpoint;
  cfg._apiKeyEnv = prov.apiKeyEnv;

  return cfg;
}

// ── API Key ────────────────────────────────────────────────────────────────
function resolveApiKey(cfg) {
  if (cfg.apiKey) return cfg.apiKey;
  if (cfg._apiKeyEnv && process.env[cfg._apiKeyEnv]) return process.env[cfg._apiKeyEnv];

  if (cfg.envPath && existsSync(cfg.envPath)) {
    const content = readFileSync(cfg.envPath, "utf-8");
    const keyName = cfg._apiKeyEnv;
    if (keyName) {
      const match = content.match(new RegExp(`${keyName}=(.+)`));
      if (match) return match[1].trim();
    }
  }

  return null;
}

// ── State Database ─────────────────────────────────────────────────────────
function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try { return JSON.parse(readFileSync(STATE_FILE, "utf-8")); } catch { return {}; }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
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

// ── LLM Call ──────────────────────────────────────────────────────────────
async function callLLM(cfg, apiKey, messages) {
  const endpoint = cfg._endpoint.replace("${MODEL}", cfg.model).replace("${API_KEY}", apiKey);

  if (cfg.provider === "anthropic") {
    return callAnthropic(endpoint, apiKey, cfg, messages);
  }
  if (cfg.provider === "gemini") {
    return callGemini(endpoint, cfg, messages);
  }
  return callOpenAICompatible(endpoint, apiKey, cfg, messages);
}

async function callOpenAICompatible(endpoint, apiKey, cfg, messages) {
  const body = {
    model: cfg.model,
    messages: [
      { role: "system", content: cfg.summaryPrompt },
      ...messages,
      { role: "user", content: "Please summarize the above conversation now." },
    ],
    max_tokens: cfg.maxTokens ?? 1200,
    temperature: cfg.temperature ?? 0.3,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? null;
}

async function callAnthropic(endpoint, apiKey, cfg, messages) {
  const userMessages = messages.map(m => ({ role: m.role, content: m.content }));
  userMessages.push({ role: "user", content: "Please summarize the above conversation now." });

  const body = {
    model: cfg.model,
    system: cfg.summaryPrompt,
    messages: userMessages,
    max_tokens: cfg.maxTokens ?? 1200,
    temperature: cfg.temperature ?? 0.3,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? null;
}

async function callGemini(endpoint, cfg, messages) {
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  contents.push({ role: "user", parts: [{ text: "Please summarize the above conversation now." }] });

  const body = {
    contents,
    systemInstruction: { parts: [{ text: cfg.summaryPrompt }] },
    generationConfig: {
      maxOutputTokens: cfg.maxTokens ?? 1200,
      temperature: cfg.temperature ?? 0.3,
    },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

// ── File Scanning ──────────────────────────────────────────────────────────
function findSummarizable(summariesPath, state, force) {
  // New instance, no summaries yet — don't error, just return empty
  if (!existsSync(summariesPath)) {
    log(`Summaries path does not exist yet: ${summariesPath}`);
    log("Nothing to do. Summary files will appear here after you /new, /fork, or quit.");
    return [];
  }

  const files = readdirSync(summariesPath)
    .filter(f => f.endsWith(".json"))
    .filter(f => force || !state[f])
    .sort();

  if (files.length === 0 && !force) {
    return [];
  }

  // Separate files that need LLM call vs already have summary embedded
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
      log(`Skipping unreadable file: ${file}`);
    }
  }

  return { needsLLM, alreadyHasSummary };
}

// ── Output Folder ──────────────────────────────────────────────────────────
function ensureOutputDir(outputPath) {
  if (!existsSync(outputPath)) {
    mkdirSync(outputPath, { recursive: true });
    log(`Created output folder: ${outputPath}`);
  }
}

// ── Summarize One File ─────────────────────────────────────────────────────
async function summarizeFile(cfg, apiKey, state, summariesPath, outputPath, filename) {
  const filepath = join(summariesPath, filename);
  const outname = filename.replace(/\.json$/, ".summary.md");
  const outpath = join(outputPath, outname);

  log(`Processing: ${filename}`);

  let data;
  try {
    data = JSON.parse(readFileSync(filepath, "utf-8"));
  } catch {
    log(`  ERROR: Cannot read ${filename}`);
    return;
  }

  if (!data.messages || data.messages.length === 0) {
    log(`  SKIP: No messages in ${filename}`);
    state[filename] = new Date().toISOString();
    saveState(state);
    return;
  }

  // Build messages: sample head + tail, extract text
  const head = data.messages.slice(0, 3);
  const tail = data.messages.slice(-30);
  const sampled = [...head, ...tail];

  const chatMessages = [];
  for (const m of sampled) {
    const role = m.role === "toolResult" ? "tool" : m.role;
    if (!["user", "assistant"].includes(role)) continue;
    const text = extractText(m.content);
    if (text.trim()) {
      chatMessages.push({ role, content: text.slice(0, 1500) });
    }
  }

  try {
    const summary = await callLLM(cfg, apiKey, chatMessages);
    if (summary) {
      const clean = extractText(summary);
      const frontmatter = buildFrontmatter(data, filename);
      writeFileSync(outpath, frontmatter + clean, "utf-8");
      log(`  DONE → ${outname}`);
      state[filename] = new Date().toISOString();
      saveState(state);
    } else {
      log(`  WARN: Empty summary for ${filename}`);
    }
  } catch (err) {
    log(`  ERROR: ${err.message}`);
  }
}

// ── Migrate Embedded Summaries ─────────────────────────────────────────────
function migrateEmbedded(summariesPath, outputPath, file, state) {
  const filepath = join(summariesPath, file);
  const outname = file.replace(/\.json$/, ".summary.md");
  const outpath = join(outputPath, outname);

  try {
    const data = JSON.parse(readFileSync(filepath, "utf-8"));
    if (typeof data.summary !== "string" || data.summary.length === 0) return;

    log(`Migrating: ${file} (already has embedded summary)`);
    const clean = extractText(data.summary);
    const frontmatter = buildFrontmatter(data, file);
    writeFileSync(outpath, frontmatter + clean, "utf-8");
    log(`  DONE → ${outname}`);
    state[file] = new Date().toISOString();
    saveState(state);
  } catch (err) {
    log(`  ERROR migrating ${file}: ${err.message}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const configIndex = args.indexOf("--config");
  const configPath = configIndex >= 0 ? resolve(args[configIndex + 1]) : DEFAULT_CONFIG;

  log(`Starting summarizer (dry-run: ${dryRun}, force: ${force})`);
  log(`Config: ${configPath}`);

  let cfg;
  try {
    cfg = resolveConfig(loadConfig(configPath));
  } catch (err) {
    log(`Config error: ${err.message}`);
    process.exit(1);
  }

  const apiKey = resolveApiKey(cfg);
  if (!apiKey) {
    log(`No API key found. Check config.apiKey, env var ${cfg._apiKeyEnv}, or ${cfg.envPath}`);
    process.exit(1);
  }
  log(`Provider: ${cfg.provider}, Model: ${cfg.model}`);
  log(`Input:  ${cfg.summariesPath}`);
  log(`Output: ${cfg.outputPath}`);

  const state = force ? {} : loadState();

  // Auto-clean stale state entries: if the source file no longer exists,
  // remove it from state so it doesn't linger forever. No --force needed.
  let cleaned = 0;
  for (const filename of Object.keys(state)) {
    if (!existsSync(join(cfg.summariesPath, filename))) {
      delete state[filename];
      cleaned++;
    }
  }
  if (cleaned > 0) {
    saveState(state);
    log(`Cleaned ${cleaned} stale state entr${cleaned === 1 ? "y" : "ies"}.`);
  }

  const result = findSummarizable(cfg.summariesPath, state, force);

  // Handle case where path doesn't exist
  if (Array.isArray(result) && result.length === 0 && !force) {
    return; // Already logged in findSummarizable
  }

  if (typeof result === "object" && "needsLLM" in result) {
    const { needsLLM, alreadyHasSummary } = result;
    const total = needsLLM.length + alreadyHasSummary.length;

    if (total === 0) {
      log("Nothing to process.");
      return;
    }

    log(`Found ${needsLLM.length} to summarize, ${alreadyHasSummary.length} to migrate.`);

    if (dryRun) {
      for (const f of needsLLM) log(`  would summarize: ${f}`);
      for (const f of alreadyHasSummary) log(`  would migrate: ${f}`);
      return;
    }

    ensureOutputDir(cfg.outputPath);

    // Migrate embedded summaries first (fast, no API calls)
    for (const file of alreadyHasSummary) {
      migrateEmbedded(cfg.summariesPath, cfg.outputPath, file, state);
    }

    // Summarize files needing LLM
    for (const file of needsLLM) {
      await summarizeFile(cfg, apiKey, state, cfg.summariesPath, cfg.outputPath, file);
    }
  }

  log("Done.");
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  console.error(err);
  process.exit(1);
});
